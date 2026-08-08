import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewJson } from "./files.js";
import { approveReview, validateReviewDraft } from "./review.js";

export const REVIEW_EDIT_SCHEMA = "podcast-visualizer-review-edit-v1";
export const REVIEW_WORKING_SCHEMA = "podcast-visualizer-review-working-v1";
export const REVIEW_WORKSPACE_SCHEMA = "podcast-visualizer-review-workspace-v1";

const LEGACY_WORKING_SCHEMA = "review-working-v1";
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const SPEAKER_ID = /^(?:speaker-0[1-6]|unknown)$/;
const CUE_ID = /^cue_[0-9]{6}$/;
const EDIT_KEYS = new Set(["schemaVersion", "parentDraftSha256", "cues"]);
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

export function validateEditableReviewCues(cues, draft) {
  validateReviewDraft(draft);
  if (!Array.isArray(cues) || cues.length < 1 || cues.length > 10000) {
    throw new CliError("review edit cues are invalid");
  }
  let priorEnd = 0;
  cues.forEach((cue, index) => {
    exactKeys(cue, CUE_KEYS, `review edit cue ${index + 1}`);
    if (!CUE_ID.test(cue.id)
        || !Number.isSafeInteger(cue.startsAtMs) || !Number.isSafeInteger(cue.endsAtMs)
        || cue.startsAtMs < priorEnd || cue.endsAtMs <= cue.startsAtMs || cue.endsAtMs > draft.durationMs
        || typeof cue.textMarkdown !== "string" || !cue.textMarkdown.trim() || cue.textMarkdown.length > 100000
        || !SPEAKER_ID.test(cue.speakerLabel) || typeof cue.speakerConfirmed !== "boolean"
        || typeof cue.speakerAmbiguous !== "boolean"
        || typeof cue.speakerConfidence !== "number" || !Number.isFinite(cue.speakerConfidence)
        || cue.speakerConfidence < 0 || cue.speakerConfidence > 1) {
      throw new CliError(`review edit cue ${index + 1} is invalid`);
    }
    priorEnd = cue.endsAtMs;
  });
  return cues;
}

export function validateReviewEdit(value, draft) {
  exactKeys(value, EDIT_KEYS, "review edit");
  if (value.schemaVersion !== REVIEW_EDIT_SCHEMA
      || value.parentDraftSha256 !== draft.manifestSha256
      || !DIGEST.test(value.parentDraftSha256)) {
    throw new CliError("review edit does not match this draft");
  }
  validateEditableReviewCues(value.cues, draft);
  return value;
}

function validateWorking(value, draft) {
  const modern = value?.schemaVersion === REVIEW_WORKING_SCHEMA;
  const allowed = new Set([
    "schemaVersion", "parentDraftSha256", "savedAt", "cues",
    ...(modern ? ["manifestSha256"] : [])
  ]);
  exactKeys(value, allowed, "review working copy");
  if (![REVIEW_WORKING_SCHEMA, LEGACY_WORKING_SCHEMA].includes(value.schemaVersion)
      || value.parentDraftSha256 !== draft.manifestSha256
      || Number.isNaN(Date.parse(value.savedAt))) {
    throw new CliError("review working copy does not match this draft");
  }
  validateEditableReviewCues(value.cues, draft);
  if (modern) {
    const { manifestSha256, ...body } = value;
    if (!DIGEST.test(manifestSha256) || manifestSha256 !== sha256(body)) {
      throw new CliError("review working copy hash does not match");
    }
  }
  return value;
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

export async function readReviewEditFile(inputPath, draft) {
  if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) {
    throw new CliError("--input must be an absolute file path", { exitCode: EXIT.usage });
  }
  return validateReviewEdit(await parseBoundedJson(path.resolve(inputPath), "review edit input"), draft);
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

export async function loadWorkingReview(projectRoot, draft) {
  const directory = await resolveReviewDirectory(projectRoot);
  const workingPath = descendantPath(directory, "working.json");
  const stat = await fsp.lstat(workingPath).catch(() => null);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError("review working copy is unsafe");
  return validateWorking(await parseBoundedJson(workingPath, "review working copy"), draft);
}

export async function loadReviewWorkspace({ projectRoot, draft, audioPath }) {
  validateReviewDraft(draft);
  if (!path.isAbsolute(projectRoot) || !path.isAbsolute(audioPath)) {
    throw new CliError("review workspace paths must be absolute");
  }
  const working = await loadWorkingReview(projectRoot, draft);
  return {
    schemaVersion: REVIEW_WORKSPACE_SCHEMA,
    projectRoot,
    draftManifestSha256: draft.manifestSha256,
    audioPath,
    durationMs: draft.durationMs,
    speakers: draft.speakers,
    cues: working?.cues ?? draft.cues,
    hasWorkingCopy: working !== null
  };
}

export async function saveWorkingReview({ projectRoot, draft, editedCues, savedAt = new Date().toISOString() }) {
  validateEditableReviewCues(editedCues, draft);
  if (Number.isNaN(Date.parse(savedAt))) throw new CliError("review working copy timestamp is invalid");
  const reviewDirectory = await resolveReviewDirectory(projectRoot, { create: true });
  const body = {
    schemaVersion: REVIEW_WORKING_SCHEMA,
    parentDraftSha256: draft.manifestSha256,
    savedAt,
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

export async function approveEditedReview({ projectRoot, draft, editedCues, approvedAt = new Date().toISOString() }) {
  validateEditableReviewCues(editedCues, draft);
  const approved = await approveReview({ draft, editedCues, approvedAt });
  const reviewDirectory = await resolveReviewDirectory(projectRoot, { create: true });
  const target = descendantPath(reviewDirectory, `${approved.transcriptId}-approved.json`);
  await writeNewJson(target, approved);
  return approved;
}
