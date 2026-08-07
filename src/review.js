import { buildAlignmentTranscriptProjection } from "@dustwave/timed-text/alignment";
import { normalizeTimedTextCues } from "@dustwave/timed-text/transcription";

import { sha256 } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { speakerForWindow, validateSpeakerTurns } from "./speaker-turns.js";

export const REVIEW_DRAFT_SCHEMA = "podcast-visualizer-review-draft-v1";
export const REVIEWED_REVISION_SCHEMA = "reviewed-transcript-revision-v1";
export const EDITORIAL_POLICY = "lightly-cleaned-verbatim-v1";

const DIGEST = /^[a-f0-9]{64}$/;
const SPEAKER_ID = /^(?:speaker-0[1-6]|unknown)$/;

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

export async function approveReview({ draft, editedCues, approvedAt = new Date().toISOString() }) {
  validateReviewDraft(draft);
  if (!Array.isArray(editedCues) || editedCues.length < 1 || editedCues.length > 10000) {
    throw new CliError("reviewed cues are invalid");
  }
  const cueInputs = editedCues.map((cue, index) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) throw new CliError(`reviewed cue ${index + 1} is invalid`);
    if (!SPEAKER_ID.test(cue.speakerLabel) || cue.speakerLabel === "unknown" || cue.speakerConfirmed !== true) {
      throw new CliError(`reviewed cue ${index + 1} requires a confirmed anonymous speaker`);
    }
    return {
      startsAtMs: cue.startsAtMs,
      endsAtMs: cue.endsAtMs,
      textMarkdown: cue.textMarkdown,
      speakerLabel: cue.speakerLabel
    };
  });
  const normalized = normalizeTimedTextCues(cueInputs, { language: "en", durationMs: draft.durationMs });
  const cues = normalized.cues.map((cue, index) => ({
    ...cue,
    speakerLabel: cueInputs[index].speakerLabel,
    speakerConfirmed: true
  }));
  const content = {
    sourceAudioSha256: draft.sourceAudioSha256,
    language: "en",
    durationMs: draft.durationMs,
    editorialPolicy: EDITORIAL_POLICY,
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
      || value.speakers.some((speaker) => !/^speaker-0[1-6]$/.test(speaker))) {
    throw new CliError("review draft speakers are invalid");
  }
  let priorEnd = 0;
  value.cues.forEach((cue, index) => {
    if (cue.id !== `cue_${String(index + 1).padStart(6, "0")}`
        || !Number.isSafeInteger(cue.startsAtMs) || !Number.isSafeInteger(cue.endsAtMs)
        || cue.startsAtMs < priorEnd || cue.endsAtMs <= cue.startsAtMs || cue.endsAtMs > value.durationMs
        || typeof cue.textMarkdown !== "string" || !cue.textMarkdown
        || !SPEAKER_ID.test(cue.speakerLabel) || typeof cue.speakerConfirmed !== "boolean"
        || typeof cue.speakerAmbiguous !== "boolean") {
      throw new CliError(`review draft cue ${index + 1} is invalid`);
    }
    priorEnd = cue.endsAtMs;
  });
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("review draft hash does not match");
  return value;
}
