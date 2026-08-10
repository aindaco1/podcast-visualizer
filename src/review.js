import { buildAlignmentTranscriptProjection } from "@dustwave/timed-text/alignment";
import {
  DIALOGUE_REFLOW_POLICY_VERSION, reflowDialogueCues
} from "@dustwave/timed-text/dialogue";
import { validateTranscriptRevisionLineage } from "@dustwave/timed-text/revisions";
import { normalizeTimedTextCues } from "@dustwave/timed-text/transcription";

import { sha256 } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { speakerForWindow, validateSpeakerTurns } from "./speaker-turns.js";

export const REVIEW_DRAFT_SCHEMA = "podcast-visualizer-review-draft-v1";
export const REVIEWED_REVISION_SCHEMA = "reviewed-transcript-revision-v3";
const LEGACY_EDITORIAL_POLICY = "lightly-cleaned-verbatim-v1";
export const EDITORIAL_POLICY = `lightly-cleaned-verbatim+${DIALOGUE_REFLOW_POLICY_VERSION}`;
const EDITORIAL_POLICIES = new Set([LEGACY_EDITORIAL_POLICY, EDITORIAL_POLICY]);

const DIGEST = /^[a-f0-9]{64}$/;
const REVIEW_SPEAKER_ID = /^speaker-(?:0[1-9]|[1-9][0-9])$/;
const SPEAKER_ID = /^(?:speaker-(?:0[1-9]|[1-9][0-9])|unknown)$/;
const DIARIZED_SPEAKER_ID = /^speaker-0[1-6]$/;
const MAXIMUM_REVIEW_SPEAKERS = 99;
const LEGACY_REVIEWED_REVISION_SCHEMA = "reviewed-transcript-revision-v1";
const VERSION_TWO_REVIEWED_REVISION_SCHEMA = "reviewed-transcript-revision-v2";
const LEGACY_REVIEWED_KEYS = new Set([
  "schemaVersion", "transcriptId", "parentDraftSha256", "approvedAt", "reviewer",
  "sourceAudioSha256", "language", "durationMs", "editorialPolicy", "cues",
  "contentSha256", "projection", "manifestSha256"
]);
const VERSION_TWO_REVIEWED_KEYS = new Set([...LEGACY_REVIEWED_KEYS, "speakers"]);
const REVIEWED_KEYS = new Set([
  ...VERSION_TWO_REVIEWED_KEYS, "parentTranscriptId", "parentRevisionSha256"
]);

export function defaultReviewSpeakers(speakerIds) {
  return speakerIds.map((id) => ({
    id,
    displayName: `Speaker ${Number(id.slice(-2))}`
  }));
}

export function validateReviewSpeakers(speakers, label = "review speakers", { allowEmpty = false } = {}) {
  if (!Array.isArray(speakers) || (!allowEmpty && speakers.length < 1)
      || speakers.length > MAXIMUM_REVIEW_SPEAKERS) {
    throw new CliError(`${label} are invalid`);
  }
  const ids = new Set();
  speakers.forEach((speaker) => {
    if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)
        || Object.keys(speaker).length !== 2
        || !Object.hasOwn(speaker, "id") || !Object.hasOwn(speaker, "displayName")
        || !REVIEW_SPEAKER_ID.test(speaker.id)
        || ids.has(speaker.id)
        || typeof speaker.displayName !== "string"
        || speaker.displayName !== speaker.displayName.normalize("NFC").trim()
        || [...speaker.displayName].length < 1 || [...speaker.displayName].length > 60
        || /[\p{Cc}\p{Cf}]/u.test(speaker.displayName)) {
      throw new CliError(`${label} are invalid`);
    }
    ids.add(speaker.id);
  });
  return speakers;
}

export function buildReviewDraft({ sourceAudioSha256, durationMs, transcription, cues, speakerTurns }) {
  if (!DIGEST.test(sourceAudioSha256)) throw new CliError("review source hash is invalid");
  validateSpeakerTurns(speakerTurns);
  if (speakerTurns.sourceAudioSha256 !== sourceAudioSha256 || speakerTurns.durationMs !== durationMs) {
    throw new CliError("review inputs do not describe the same audio");
  }
  if (!transcription || typeof transcription !== "object" || Array.isArray(transcription)) {
    throw new CliError("transcription identity is invalid");
  }
  for (const key of ["engine", "version", "model", "modelVersion"]) {
    if (typeof transcription[key] !== "string" || !transcription[key] || transcription[key].length > 180) {
      throw new CliError(`transcription ${key} is invalid`);
    }
  }
  const timedText = normalizeTimedTextCues(cues, { language: "en", durationMs });
  const reviewCues = timedText.cues.map((cue) => {
    const attribution = speakerForWindow(cue.startsAtMs, cue.endsAtMs, speakerTurns);
    return {
      id: cue.id,
      startsAtMs: cue.startsAtMs,
      endsAtMs: cue.endsAtMs,
      textMarkdown: cue.textMarkdown,
      speakerLabel: attribution.speakerId,
      speakerConfirmed: false,
      speakerConfidence: Number(attribution.confidence.toFixed(6)),
      speakerAmbiguous: attribution.ambiguous
    };
  });
  const body = {
    schemaVersion: REVIEW_DRAFT_SCHEMA,
    sourceAudioSha256,
    durationMs,
    language: "en",
    transcription: Object.fromEntries(["engine", "version", "model", "modelVersion"].map((key) => [key, transcription[key]])),
    speakerManifestSha256: speakerTurns.manifestSha256,
    speakers: speakerTurns.speakers.map(({ id }) => id),
    cues: reviewCues
  };
  return { ...body, manifestSha256: sha256(body) };
}

export async function approveReview({
  draft,
  editedCues,
  speakers = defaultReviewSpeakers(draft.speakers),
  parentRevision = null,
  approvedAt = new Date().toISOString()
}) {
  validateReviewDraft(draft);
  validateReviewSpeakers(speakers);
  if (parentRevision !== null) {
    await validateReviewedRevision(parentRevision);
    if (parentRevision.sourceAudioSha256 !== draft.sourceAudioSha256
        || parentRevision.durationMs !== draft.durationMs) {
      throw new CliError("review revision parent does not describe this draft");
    }
  }
  const speakerIds = new Set(speakers.map(({ id }) => id));
  if (!Array.isArray(editedCues) || editedCues.length < 1 || editedCues.length > 10000) {
    throw new CliError("reviewed cues are invalid");
  }
  const cueInputs = editedCues.map((cue, index) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) throw new CliError(`reviewed cue ${index + 1} is invalid`);
    if (!SPEAKER_ID.test(cue.speakerLabel) || cue.speakerLabel === "unknown"
        || !speakerIds.has(cue.speakerLabel) || cue.speakerConfirmed !== true) {
      throw new CliError(`reviewed cue ${index + 1} requires a confirmed anonymous speaker`);
    }
    return {
      startsAtMs: cue.startsAtMs,
      endsAtMs: cue.endsAtMs,
      textMarkdown: cue.textMarkdown,
      speakerLabel: cue.speakerLabel
    };
  });
  const canonicalInput = normalizeTimedTextCues(cueInputs, {
    language: "en", durationMs: draft.durationMs
  });
  const dialogueCues = canonicalInput.cues.map((cue, index) => ({
    startsAtMs: cue.startsAtMs,
    endsAtMs: cue.endsAtMs,
    textMarkdown: cue.textMarkdown,
    speakerLabel: cueInputs[index].speakerLabel
  }));
  const reflowed = reflowDialogueCues(dialogueCues, { durationMs: draft.durationMs });
  const normalized = normalizeTimedTextCues(reflowed, { language: "en", durationMs: draft.durationMs });
  const cues = normalized.cues.map((cue, index) => ({
    ...cue,
    speakerLabel: reflowed[index].speakerLabel,
    speakerConfirmed: true
  }));
  const content = {
    sourceAudioSha256: draft.sourceAudioSha256,
    language: "en",
    durationMs: draft.durationMs,
    editorialPolicy: EDITORIAL_POLICY,
    speakers,
    cues
  };
  const contentSha256 = sha256(content);
  const transcriptId = `transcript_${contentSha256.slice(0, 24)}`;
  const projection = await buildAlignmentTranscriptProjection({
    transcriptId,
    contentSha256,
    language: "en",
    cues
  });
  const body = {
    schemaVersion: REVIEWED_REVISION_SCHEMA,
    transcriptId,
    parentDraftSha256: draft.manifestSha256,
    parentTranscriptId: parentRevision?.transcriptId ?? null,
    parentRevisionSha256: parentRevision?.manifestSha256 ?? null,
    approvedAt,
    reviewer: "local-human",
    ...content,
    contentSha256,
    projection
  };
  return { ...body, manifestSha256: sha256(body) };
}

export function validateReviewDraft(value) {
  const allowed = new Set([
    "schemaVersion", "sourceAudioSha256", "durationMs", "language", "transcription",
    "speakerManifestSha256", "speakers", "cues", "manifestSha256"
  ]);
  if (!value || value.schemaVersion !== REVIEW_DRAFT_SCHEMA || !DIGEST.test(value.sourceAudioSha256)) {
    throw new CliError("review draft identity is invalid");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CliError(`review draft contains unknown field: ${key}`);
  }
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.language !== "en") {
    throw new CliError("review draft timing or language is invalid");
  }
  if (!Array.isArray(value.cues) || value.cues.length < 1 || value.cues.length > 10000) {
    throw new CliError("review draft cues are invalid");
  }
  if (!Array.isArray(value.speakers) || value.speakers.length < 1 || value.speakers.length > 6
      || new Set(value.speakers).size !== value.speakers.length
      || value.speakers.some((speaker) => !DIARIZED_SPEAKER_ID.test(speaker))) {
    throw new CliError("review draft speakers are invalid");
  }
  const draftSpeakerIds = new Set(value.speakers);
  let priorEnd = 0;
  value.cues.forEach((cue, index) => {
    if (cue.id !== `cue_${String(index + 1).padStart(6, "0")}`
        || !Number.isSafeInteger(cue.startsAtMs) || !Number.isSafeInteger(cue.endsAtMs)
        || cue.startsAtMs < priorEnd || cue.endsAtMs <= cue.startsAtMs || cue.endsAtMs > value.durationMs
        || typeof cue.textMarkdown !== "string" || !cue.textMarkdown
        || !SPEAKER_ID.test(cue.speakerLabel)
        || (cue.speakerLabel !== "unknown" && !draftSpeakerIds.has(cue.speakerLabel))
        || typeof cue.speakerConfirmed !== "boolean"
        || typeof cue.speakerAmbiguous !== "boolean") {
      throw new CliError(`review draft cue ${index + 1} is invalid`);
    }
    priorEnd = cue.endsAtMs;
  });
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("review draft hash does not match");
  return value;
}

export async function validateReviewedRevision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("reviewed transcript is invalid");
  }
  const legacy = value.schemaVersion === LEGACY_REVIEWED_REVISION_SCHEMA;
  const versionTwo = value.schemaVersion === VERSION_TWO_REVIEWED_REVISION_SCHEMA;
  const keys = legacy ? LEGACY_REVIEWED_KEYS : versionTwo ? VERSION_TWO_REVIEWED_KEYS : REVIEWED_KEYS;
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new CliError(`reviewed transcript contains unknown field: ${key}`);
  }
  if (![
    REVIEWED_REVISION_SCHEMA,
    VERSION_TWO_REVIEWED_REVISION_SCHEMA,
    LEGACY_REVIEWED_REVISION_SCHEMA
  ].includes(value.schemaVersion)
      || !/^transcript_[a-f0-9]{24}$/.test(value.transcriptId)
      || !DIGEST.test(value.parentDraftSha256)
      || value.reviewer !== "local-human"
      || value.language !== "en"
      || !EDITORIAL_POLICIES.has(value.editorialPolicy)
      || !DIGEST.test(value.sourceAudioSha256)
      || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1
      || !DIGEST.test(value.contentSha256)
      || !DIGEST.test(value.manifestSha256)
      || Number.isNaN(Date.parse(value.approvedAt))) {
    throw new CliError("reviewed transcript identity is invalid");
  }
  if (!legacy) validateReviewSpeakers(value.speakers, "reviewed transcript speakers");
  const speakerIds = legacy ? null : new Set(value.speakers.map(({ id }) => id));
  if (!Array.isArray(value.cues) || value.cues.length < 1 || value.cues.length > 10000) {
    throw new CliError("reviewed transcript cues are invalid");
  }
  let priorEnd = 0;
  for (const [index, cue] of value.cues.entries()) {
    const allowed = new Set(["id", "startsAtMs", "endsAtMs", "textMarkdown", "speakerLabel", "speakerConfirmed"]);
    if (!cue || typeof cue !== "object" || Array.isArray(cue)
        || Object.keys(cue).some((key) => !allowed.has(key))
        || cue.id !== `cue_${String(index + 1).padStart(6, "0")}`
        || !Number.isSafeInteger(cue.startsAtMs) || !Number.isSafeInteger(cue.endsAtMs)
        || cue.startsAtMs < priorEnd || cue.endsAtMs <= cue.startsAtMs || cue.endsAtMs > value.durationMs
        || typeof cue.textMarkdown !== "string" || !cue.textMarkdown
        || !SPEAKER_ID.test(cue.speakerLabel) || cue.speakerLabel === "unknown"
        || (speakerIds && !speakerIds.has(cue.speakerLabel))
        || cue.speakerConfirmed !== true) {
      throw new CliError(`reviewed transcript cue ${index + 1} is invalid`);
    }
    priorEnd = cue.endsAtMs;
  }
  const content = {
    sourceAudioSha256: value.sourceAudioSha256,
    language: value.language,
    durationMs: value.durationMs,
    editorialPolicy: value.editorialPolicy,
    ...(!legacy ? { speakers: value.speakers } : {}),
    cues: value.cues
  };
  if (sha256(content) !== value.contentSha256
      || value.transcriptId !== `transcript_${value.contentSha256.slice(0, 24)}`) {
    throw new CliError("reviewed transcript content hash does not match");
  }
  const projection = await buildAlignmentTranscriptProjection({
    transcriptId: value.transcriptId,
    contentSha256: value.contentSha256,
    language: value.language,
    cues: value.cues
  });
  if (sha256(projection) !== sha256(value.projection)) {
    throw new CliError("reviewed transcript alignment projection does not match");
  }
  const { manifestSha256, ...body } = value;
  if (sha256(body) !== manifestSha256) throw new CliError("reviewed transcript hash does not match");
  if (!legacy && !versionTwo) {
    try {
      validateTranscriptRevisionLineage({
        transcriptId: value.transcriptId,
        sourceAudioSha256: value.sourceAudioSha256,
        revisionSha256: value.manifestSha256,
        parentTranscriptId: value.parentTranscriptId,
        parentRevisionSha256: value.parentRevisionSha256
      });
    } catch {
      throw new CliError("reviewed transcript lineage is invalid");
    }
  }
  return value;
}
