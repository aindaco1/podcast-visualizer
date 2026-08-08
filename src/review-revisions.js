import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";

import {
  buildActiveTranscriptPointer,
  validateActiveTranscriptPointer,
  validateTranscriptRevisionLineage
} from "@dustwave/timed-text/revisions";

import { canonicalJson } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { descendantPath } from "./files.js";
import { validateReviewedRevision } from "./review.js";

export const ACTIVE_TRANSCRIPT_FILE = "active-transcript.json";

const TRANSCRIPT_FILE = /^(transcript_[a-f0-9]{24})-approved\.json$/;
const MAXIMUM_REVISION_BYTES = 8 * 1024 * 1024;
const MAXIMUM_POINTER_BYTES = 16 * 1024;

async function reviewDirectory(projectRoot, { create = false } = {}) {
  const directory = descendantPath(projectRoot, "review");
  if (create) await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError("review directory is missing or unsafe");
  }
  return directory;
}

async function readJson(filePath, maximumBytes, label) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()
      || stat.size < 1 || stat.size > maximumBytes) {
    throw new CliError(`${label} is missing or outside its size bound`);
  }
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

async function approvedNames(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!TRANSCRIPT_FILE.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`approved transcript revision is unsafe: ${entry.name}`);
    }
    names.push(entry.name);
  }
  return names.sort();
}

async function loadNamedRevision(directory, transcriptId) {
  if (!/^transcript_[a-f0-9]{24}$/.test(String(transcriptId))) {
    throw new CliError("approved transcript ID is invalid");
  }
  const name = `${transcriptId}-approved.json`;
  const revision = await validateReviewedRevision(await readJson(
    descendantPath(directory, name),
    MAXIMUM_REVISION_BYTES,
    "approved transcript revision"
  ));
  if (revision.transcriptId !== transcriptId) {
    throw new CliError("approved transcript filename does not match its revision");
  }
  return { transcript: revision, filePath: descendantPath(directory, name) };
}

export async function resolveActiveTranscript({
  projectRoot,
  projectId,
  sourceAudioSha256,
  required = false
}) {
  const directory = await reviewDirectory(projectRoot);
  const pointerPath = descendantPath(directory, ACTIVE_TRANSCRIPT_FILE);
  const pointerStat = await fsp.lstat(pointerPath).catch(() => null);
  if (pointerStat) {
    if (pointerStat.isSymbolicLink() || !pointerStat.isFile()
        || pointerStat.size < 1 || pointerStat.size > MAXIMUM_POINTER_BYTES) {
      throw new CliError("active transcript pointer is unsafe");
    }
    let pointer;
    try {
      pointer = await validateActiveTranscriptPointer(
        await readJson(pointerPath, MAXIMUM_POINTER_BYTES, "active transcript pointer"),
        {
          ...(projectId ? { projectId } : {}),
          ...(sourceAudioSha256 ? { sourceAudioSha256 } : {})
        }
      );
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("active transcript pointer is invalid");
    }
    const resolved = await loadNamedRevision(directory, pointer.transcriptId);
    if (resolved.transcript.manifestSha256 !== pointer.revisionSha256
        || resolved.transcript.sourceAudioSha256 !== pointer.sourceAudioSha256
        || (resolved.transcript.parentTranscriptId ?? null) !== pointer.parentTranscriptId) {
      throw new CliError("active transcript pointer does not match its revision");
    }
    return { ...resolved, pointer, legacySelection: false };
  }

  const names = await approvedNames(directory);
  if (names.length === 0) {
    if (required) throw new CliError("an approved transcript is required");
    return null;
  }
  if (names.length > 1) {
    throw new CliError("multiple approved transcript revisions have no active selection", {
      hint: "Open the project in Podcast Visualizer 1.0.0 and retain one approved revision, or select a revision explicitly before migrating."
    });
  }
  const transcriptId = TRANSCRIPT_FILE.exec(names[0])[1];
  const resolved = await loadNamedRevision(directory, transcriptId);
  if (sourceAudioSha256
      && resolved.transcript.sourceAudioSha256 !== sourceAudioSha256) {
    throw new CliError("approved transcript does not describe this project audio");
  }
  return { ...resolved, pointer: null, legacySelection: true };
}

export async function loadTranscriptById({ projectRoot, transcriptId }) {
  const directory = await reviewDirectory(projectRoot);
  const names = await approvedNames(directory);
  if (!names.includes(`${transcriptId}-approved.json`)) {
    throw new CliError("requested approved transcript was not found");
  }
  return loadNamedRevision(directory, transcriptId);
}

export async function advanceActiveTranscript({
  projectRoot,
  projectId,
  sourceAudioSha256,
  approved,
  expectedParent = null,
  updatedAt = new Date().toISOString()
}) {
  await validateReviewedRevision(approved);
  const directory = await reviewDirectory(projectRoot, { create: true });
  const pointerPath = descendantPath(directory, ACTIVE_TRANSCRIPT_FILE);
  const pointerStat = await fsp.lstat(pointerPath).catch(() => null);
  let current;
  if (pointerStat) {
    current = await resolveActiveTranscript({
      projectRoot, projectId, sourceAudioSha256, required: false
    });
  } else {
    const priorNames = (await approvedNames(directory)).filter(
      (name) => name !== `${approved.transcriptId}-approved.json`
    );
    if (priorNames.length > 1) {
      throw new CliError("multiple approved transcript revisions have no active selection");
    }
    current = priorNames.length === 0 ? null : {
      ...await loadNamedRevision(directory, TRANSCRIPT_FILE.exec(priorNames[0])[1]),
      pointer: null,
      legacySelection: true
    };
  }
  if ((expectedParent === null) !== (current === null)
      || (expectedParent && current
        && (expectedParent.transcriptId !== current.transcript.transcriptId
          || expectedParent.manifestSha256 !== current.transcript.manifestSha256))) {
    throw new CliError("active transcript changed while this edit was open");
  }
  if (approved.sourceAudioSha256 !== sourceAudioSha256) {
    throw new CliError("new transcript revision does not describe this project audio");
  }
  try {
    validateTranscriptRevisionLineage({
      transcriptId: approved.transcriptId,
      sourceAudioSha256: approved.sourceAudioSha256,
      revisionSha256: approved.manifestSha256,
      parentTranscriptId: approved.parentTranscriptId,
      parentRevisionSha256: approved.parentRevisionSha256
    }, current ? {
      transcriptId: current.transcript.transcriptId,
      sourceAudioSha256: current.transcript.sourceAudioSha256,
      revisionSha256: current.transcript.manifestSha256
    } : null);
  } catch {
    throw new CliError("new transcript revision lineage is invalid");
  }
  const pointer = await buildActiveTranscriptPointer({
    projectId,
    sourceAudioSha256,
    transcriptId: approved.transcriptId,
    parentTranscriptId: approved.parentTranscriptId,
    revisionSha256: approved.manifestSha256,
    updatedAt
  });
  const target = descendantPath(directory, ACTIVE_TRANSCRIPT_FILE);
  const existing = await fsp.lstat(target).catch(() => null);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new CliError("active transcript pointer is unsafe");
  }
  const temporary = descendantPath(
    directory,
    `.active-transcript-${randomBytes(6).toString("hex")}.json`
  );
  try {
    await fsp.writeFile(temporary, `${canonicalJson(pointer)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    await fsp.rename(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
  return pointer;
}
