import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewJson } from "./files.js";
import {
  approveReview, defaultReviewSpeakers, validateReviewBoundaryHints,
  validateReviewDraft, validateReviewSpeakers
} from "./review.js";
import { advanceActiveTranscript } from "./review-revisions.js";

export const REVIEW_EDIT_SCHEMA = "podcast-visualizer-review-edit-v4";
export const REVIEW_WORKING_SCHEMA = "podcast-visualizer-review-working-v3";
export const REVIEW_WORKSPACE_SCHEMA = "podcast-visualizer-review-workspace-v3";

const LEGACY_WORKING_SCHEMA = "review-working-v1";
const VERSION_ONE_EDIT_SCHEMA = "podcast-visualizer-review-edit-v1";
const VERSION_ONE_WORKING_SCHEMA = "podcast-visualizer-review-working-v1";
const VERSION_TWO_EDIT_SCHEMA = "podcast-visualizer-review-edit-v2";
const VERSION_TWO_WORKING_SCHEMA = "podcast-visualizer-review-working-v2";
const VERSION_THREE_EDIT_SCHEMA = "podcast-visualizer-review-edit-v3";
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const SPEAKER_ID = /^(?:speaker-(?:0[1-9]|[1-9][0-9])|unknown)$/;
const CUE_ID = /^cue_[0-9]{6}$/;
const EDIT_KEYS = new Set([
  "schemaVersion", "parentDraftSha256", "baseTranscriptId", "baseRevisionSha256",
  "speakers", "cues", "reflowBoundaryHints"
]);
const VERSION_THREE_EDIT_KEYS = new Set([
  "schemaVersion", "parentDraftSha256", "baseTranscriptId", "baseRevisionSha256",
  "speakers", "cues"
]);
const VERSION_TWO_EDIT_KEYS = new Set(["schemaVersion", "parentDraftSha256", "speakers", "cues"]);
const VERSION_ONE_EDIT_KEYS = new Set(["schemaVersion", "parentDraftSha256", "cues"]);
const CUE_KEYS = new Set([
  "id", "startsAtMs", "endsAtMs", "textMarkdown", "speakerLabel",
  "speakerConfirmed", "speakerConfidence", "speakerAmbiguous"
]);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} is invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CliError(`${label} contains unknown field: ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) throw new CliError(`${label} is missing field: ${key}`);
  }
}

export function validateEditableReviewCues(cues, draft, speakers = defaultReviewSpeakers(draft.speakers)) {
  validateReviewDraft(draft);
  validateReviewSpeakers(speakers, "review speakers", { allowEmpty: true });
  const speakerIds = new Set(speakers.map(({ id }) => id));
  if (!Array.isArray(cues) || cues.length < 1 || cues.length > 10000) {
    throw new CliError("review edit cues are invalid");
  }
  let priorEnd = 0;
  const cueIds = new Set();
  cues.forEach((cue, index) => {
    exactKeys(cue, CUE_KEYS, `review edit cue ${index + 1}`);
    if (!CUE_ID.test(cue.id)
        || cueIds.has(cue.id)
        || !Number.isSafeInteger(cue.startsAtMs) || !Number.isSafeInteger(cue.endsAtMs)
        || cue.startsAtMs < priorEnd || cue.endsAtMs <= cue.startsAtMs || cue.endsAtMs > draft.durationMs
        || typeof cue.textMarkdown !== "string" || !cue.textMarkdown.trim() || cue.textMarkdown.length > 100000
        || !SPEAKER_ID.test(cue.speakerLabel)
        || (cue.speakerLabel !== "unknown" && !speakerIds.has(cue.speakerLabel))
        || typeof cue.speakerConfirmed !== "boolean"
        || typeof cue.speakerAmbiguous !== "boolean"
        || typeof cue.speakerConfidence !== "number" || !Number.isFinite(cue.speakerConfidence)
        || cue.speakerConfidence < 0 || cue.speakerConfidence > 1) {
      throw new CliError(`review edit cue ${index + 1} is invalid`);
    }
    cueIds.add(cue.id);
    priorEnd = cue.endsAtMs;
  });
  return cues;
}

function revisionIdentity(baseRevision) {
  return {
    baseTranscriptId: baseRevision?.transcriptId ?? null,
    baseRevisionSha256: baseRevision?.manifestSha256 ?? null
  };
}

function matchesRevisionIdentity(value, baseRevision) {
  const expected = revisionIdentity(baseRevision);
  return value.baseTranscriptId === expected.baseTranscriptId
    && value.baseRevisionSha256 === expected.baseRevisionSha256;
}

export function validateReviewEdit(value, draft, baseRevision = null) {
  const legacy = value?.schemaVersion === VERSION_ONE_EDIT_SCHEMA;
  const versionTwo = value?.schemaVersion === VERSION_TWO_EDIT_SCHEMA;
  const versionThree = value?.schemaVersion === VERSION_THREE_EDIT_SCHEMA;
  exactKeys(
    value,
    legacy ? VERSION_ONE_EDIT_KEYS
      : versionTwo ? VERSION_TWO_EDIT_KEYS
        : versionThree ? VERSION_THREE_EDIT_KEYS : EDIT_KEYS,
    "review edit"
  );
  if (![
    REVIEW_EDIT_SCHEMA, VERSION_THREE_EDIT_SCHEMA, VERSION_TWO_EDIT_SCHEMA,
    VERSION_ONE_EDIT_SCHEMA
  ].includes(value.schemaVersion)
      || value.parentDraftSha256 !== draft.manifestSha256
      || !DIGEST.test(value.parentDraftSha256)) {
    throw new CliError("review edit does not match this draft");
  }
  const identity = legacy || versionTwo
    ? { baseTranscriptId: null, baseRevisionSha256: null }
    : {
        baseTranscriptId: value.baseTranscriptId,
        baseRevisionSha256: value.baseRevisionSha256
      };
  if ((identity.baseTranscriptId !== null
      && !/^transcript_[a-f0-9]{24}$/.test(identity.baseTranscriptId))
      || (identity.baseRevisionSha256 !== null && !DIGEST.test(identity.baseRevisionSha256))
      || (identity.baseTranscriptId === null) !== (identity.baseRevisionSha256 === null)
      || !matchesRevisionIdentity(identity, baseRevision)) {
    throw new CliError("review edit does not match the active transcript revision");
  }
  const speakers = legacy ? defaultReviewSpeakers(draft.speakers) : value.speakers;
  validateEditableReviewCues(value.cues, draft, speakers);
  const reflowBoundaryHints = value.schemaVersion === REVIEW_EDIT_SCHEMA
    ? value.reflowBoundaryHints : [];
  validateReviewBoundaryHints(reflowBoundaryHints, value.cues);
  return { ...value, ...identity, speakers, reflowBoundaryHints };
}

function validateWorking(value, draft) {
  const modern = value?.schemaVersion === REVIEW_WORKING_SCHEMA;
  const versionTwo = value?.schemaVersion === VERSION_TWO_WORKING_SCHEMA;
  const hashedVersionOne = value?.schemaVersion === VERSION_ONE_WORKING_SCHEMA;
  const allowed = new Set([
    "schemaVersion", "parentDraftSha256", "savedAt", "cues",
    ...(modern || versionTwo ? ["speakers"] : []),
    ...(modern ? ["baseTranscriptId", "baseRevisionSha256"] : []),
    ...(modern || versionTwo || hashedVersionOne ? ["manifestSha256"] : [])
  ]);
  exactKeys(value, allowed, "review working copy");
  if (![
    REVIEW_WORKING_SCHEMA,
    VERSION_TWO_WORKING_SCHEMA,
    VERSION_ONE_WORKING_SCHEMA,
    LEGACY_WORKING_SCHEMA
  ].includes(value.schemaVersion)
      || value.parentDraftSha256 !== draft.manifestSha256
      || Number.isNaN(Date.parse(value.savedAt))) {
    throw new CliError("review working copy does not match this draft");
  }
  const speakers = modern || versionTwo ? value.speakers : defaultReviewSpeakers(draft.speakers);
  validateEditableReviewCues(value.cues, draft, speakers);
  if (modern || versionTwo || hashedVersionOne) {
    const { manifestSha256, ...body } = value;
    if (!DIGEST.test(manifestSha256) || manifestSha256 !== sha256(body)) {
      throw new CliError("review working copy hash does not match");
    }
  }
  const identity = modern ? {
    baseTranscriptId: value.baseTranscriptId,
    baseRevisionSha256: value.baseRevisionSha256
  } : { baseTranscriptId: null, baseRevisionSha256: null };
  if ((identity.baseTranscriptId !== null
      && !/^transcript_[a-f0-9]{24}$/.test(identity.baseTranscriptId))
      || (identity.baseRevisionSha256 !== null && !DIGEST.test(identity.baseRevisionSha256))
      || (identity.baseTranscriptId === null) !== (identity.baseRevisionSha256 === null)) {
    throw new CliError("review working copy revision identity is invalid");
  }
  return { ...value, ...identity, speakers };
}

async function resolveReviewDirectory(projectRoot, { create = false } = {}) {
  const directory = descendantPath(projectRoot, "review");
  if (create) await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError("review directory is missing or unsafe");
  }
  return directory;
}

async function parseBoundedJson(filePath, label) {
  let stat;
  let linkStat;
  try {
    linkStat = await fsp.lstat(filePath);
    stat = await fsp.stat(filePath);
  } catch {
    throw new CliError(`${label} does not exist`, { exitCode: EXIT.usage });
  }
  if (linkStat.isSymbolicLink() || !stat.isFile()) {
    throw new CliError(`${label} must be a regular file, not a symlink`, { exitCode: EXIT.usage });
  }
  if (stat.size < 1 || stat.size > MAXIMUM_JSON_BYTES) {
    throw new CliError(`${label} is outside the supported size`, { exitCode: EXIT.usage });
  }
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`, { exitCode: EXIT.usage });
  }
}

export async function readReviewEditFile(inputPath, draft, baseRevision = null) {
  if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) {
    throw new CliError("--input must be an absolute file path", { exitCode: EXIT.usage });
  }
  return validateReviewEdit(
    await parseBoundedJson(path.resolve(inputPath), "review edit input"),
    draft,
    baseRevision
  );
}

export async function loadReviewDraft(projectRoot) {
  const directory = await resolveReviewDirectory(projectRoot);
  const draftPath = descendantPath(directory, "draft.json");
  try {
    return validateReviewDraft(await parseBoundedJson(draftPath, "review draft"));
  } catch (error) {
    if (error instanceof CliError && error.message !== "review draft does not exist") throw error;
    throw new CliError("review draft is missing or invalid", {
      hint: "Run dustwave-video analyze before review."
    });
  }
}

export async function loadWorkingReview(projectRoot, draft, baseRevision = null) {
  const directory = await resolveReviewDirectory(projectRoot);
  const workingPath = descendantPath(directory, "working.json");
  const stat = await fsp.lstat(workingPath).catch(() => null);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError("review working copy is unsafe");
  const working = validateWorking(
    await parseBoundedJson(workingPath, "review working copy"),
    draft
  );
  return matchesRevisionIdentity(working, baseRevision) ? working : null;
}

export async function loadReviewWorkspace({ projectRoot, draft, audioPath, baseRevision = null }) {
  validateReviewDraft(draft);
  if (!path.isAbsolute(projectRoot) || !path.isAbsolute(audioPath)) {
    throw new CliError("review workspace paths must be absolute");
  }
  const working = await loadWorkingReview(projectRoot, draft, baseRevision);
  const revisionCues = baseRevision?.cues.map((cue) => ({
    ...cue,
    speakerConfidence: 1,
    speakerAmbiguous: false
  }));
  const identity = revisionIdentity(baseRevision);
  return {
    schemaVersion: REVIEW_WORKSPACE_SCHEMA,
    projectRoot,
    draftManifestSha256: draft.manifestSha256,
    ...identity,
    audioPath,
    durationMs: draft.durationMs,
    speakers: working?.speakers ?? baseRevision?.speakers ?? defaultReviewSpeakers(draft.speakers),
    cues: working?.cues ?? revisionCues ?? draft.cues,
    hasWorkingCopy: working !== null
  };
}

export async function saveWorkingReview({
  projectRoot,
  draft,
  editedCues,
  speakers = defaultReviewSpeakers(draft.speakers),
  baseRevision = null,
  savedAt = new Date().toISOString()
}) {
  validateEditableReviewCues(editedCues, draft, speakers);
  if (Number.isNaN(Date.parse(savedAt))) throw new CliError("review working copy timestamp is invalid");
  const reviewDirectory = await resolveReviewDirectory(projectRoot, { create: true });
  const body = {
    schemaVersion: REVIEW_WORKING_SCHEMA,
    parentDraftSha256: draft.manifestSha256,
    ...revisionIdentity(baseRevision),
    savedAt,
    speakers,
    cues: editedCues
  };
  const working = { ...body, manifestSha256: sha256(body) };
  const target = descendantPath(reviewDirectory, "working.json");
  const existing = await fsp.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new CliError("review working copy is unsafe");
  }
  const temporary = descendantPath(reviewDirectory, `.working-${randomBytes(6).toString("hex")}.json`);
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(working, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fsp.rename(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
  return { ok: true, workingSha256: working.manifestSha256 };
}

export async function approveEditedReview({
  projectRoot,
  projectId,
  sourceAudioSha256,
  draft,
  editedCues,
  speakers = defaultReviewSpeakers(draft.speakers),
  reflowBoundaryHints = [],
  baseRevision = null,
  approvedAt = new Date().toISOString()
}) {
  validateEditableReviewCues(editedCues, draft, speakers);
  const approved = await approveReview({
    draft, editedCues, speakers, reflowBoundaryHints,
    parentRevision: baseRevision, approvedAt
  });
  if (baseRevision
      && approved.transcriptId === baseRevision.transcriptId
      && approved.contentSha256 === baseRevision.contentSha256) {
    return baseRevision;
  }
  const reviewDirectory = await resolveReviewDirectory(projectRoot, { create: true });
  const target = descendantPath(reviewDirectory, `${approved.transcriptId}-approved.json`);
  await writeNewJson(target, approved);
  await advanceActiveTranscript({
    projectRoot,
    projectId,
    sourceAudioSha256,
    approved,
    expectedParent: baseRevision,
    updatedAt: approvedAt
  });
  return approved;
}
