import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  compileChapterEntries,
  formatMarkdownChapters,
  formatYouTubeChapters,
  planChapterContext,
  validateChapterList
} from "@dustwave/timed-text/chapters";

import { loadActiveAlignment } from "./alignment.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewFile, writeNewJson } from "./files.js";

export const CHAPTER_CONTEXT_ARTIFACT_SCHEMA = "podcast-visualizer-chapter-context-v1";
export const CHAPTER_EDIT_SCHEMA = "podcast-visualizer-chapter-edit-v1";
export const APPROVED_CHAPTERS_SCHEMA = "podcast-visualizer-approved-chapters-v1";
export const CHAPTER_WORKSPACE_SCHEMA = "podcast-visualizer-chapter-workspace-v1";

const ACTIVE_CHAPTERS_SCHEMA = "podcast-visualizer-active-chapters-v1";
const MAXIMUM_CHAPTER_FILE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CONTEXT_BYTES = 3 * 1024 * 1024;
const EXACT_DIGEST = /^[a-f0-9]{64}$/u;
const CONTEXT_ID = /^chapter_context_[a-f0-9]{24}$/u;
const REVISION_ID = /^chapters_[a-f0-9]{24}$/u;
const CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

function exactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== allowed.size
      || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new CliError(`${label} contains unexpected fields`, { exitCode: EXIT.usage });
  }
}

async function boundedJson(filePath, label, { optional = false } = {}) {
  const stat = await fsp.lstat(filePath).catch((error) => {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()
      || stat.size < 1 || stat.size > MAXIMUM_CHAPTER_FILE_BYTES) {
    throw new CliError(`${label} is missing or unsafe`);
  }
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

async function chapterDirectory(projectRoot, { create = true } = {}) {
  const directory = descendantPath(projectRoot, "chapters");
  const existing = await fsp.lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!existing && create) {
    await fsp.mkdir(directory, { mode: 0o700 });
    return directory;
  }
  if (!existing || existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new CliError("chapter workspace directory is missing or unsafe");
  }
  return directory;
}

async function childDirectory(parent, name) {
  const directory = descendantPath(parent, name);
  const existing = await fsp.lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!existing) {
    await fsp.mkdir(directory, { mode: 0o700 });
    return directory;
  }
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new CliError(`chapter ${name} directory is unsafe`);
  }
  return directory;
}

async function writeOrVerifyJson(filePath, value, label) {
  try {
    await writeNewJson(filePath, value);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await boundedJson(filePath, label);
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new CliError(`${label} already exists with different content`);
    }
  }
}

async function writeOrVerifyText(filePath, content, label) {
  try {
    await writeNewFile(filePath, content);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const stat = await fsp.lstat(filePath).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()
        || stat.size > MAXIMUM_CHAPTER_FILE_BYTES
        || await fsp.readFile(filePath, "utf8") !== content) {
      throw new CliError(`${label} already exists with different or unsafe content`);
    }
  }
}

async function replaceJson(filePath, value, label) {
  const existing = await fsp.lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new CliError(`${label} is unsafe`);
  }
  const directory = path.dirname(filePath);
  const temporary = descendantPath(
    directory,
    `.chapter-${randomBytes(8).toString("hex")}.json`
  );
  try {
    await fsp.writeFile(temporary, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
    await fsp.rename(temporary, filePath);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

function sourceCues(transcript, alignment) {
  const candidates = new Map(
    alignment.manifest.candidateWords.map((candidate) => [candidate.wordId, candidate])
  );
  let previousEnd = 0;
  return transcript.cues.map((cue, index) => {
    const projected = transcript.projection.cues[index];
    if (!projected || projected.cueId !== cue.id || !Array.isArray(projected.words)
        || projected.words.length < 1) {
      throw new CliError("chapter source projection is inconsistent");
    }
    const firstWord = projected.words[0];
    const lastWord = projected.words.at(-1);
    const first = candidates.get(firstWord.wordId);
    const last = candidates.get(lastWord.wordId);
    if (!first || !last || first.cueId !== cue.id || last.cueId !== cue.id
        || !CANDIDATE_ID.test(firstWord.wordId)
        || !Number.isSafeInteger(first.startsAtMs) || first.startsAtMs < previousEnd
        || !Number.isSafeInteger(last.endsAtMs) || last.endsAtMs <= first.startsAtMs) {
      throw new CliError("chapter source alignment is incomplete", {
        exitCode: EXIT.qualityGate,
        hint: "Re-run alignment after confirming the transcript. Existing project files were preserved."
      });
    }
    previousEnd = last.endsAtMs;
    return {
      cueId: cue.id,
      sourceWordId: firstWord.wordId,
      startsAtMs: first.startsAtMs,
      endsAtMs: last.endsAtMs,
      speakerId: cue.speakerLabel,
      text: cue.textMarkdown
    };
  });
}

export function buildChapterContextArtifact({ prepared, transcript, alignment, mode = "topics" }) {
  let context;
  try {
    context = planChapterContext(sourceCues(transcript, alignment), {
      durationMs: prepared.prepare.analysis.durationMs,
      mode
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("chapter context failed the shared timed-text contract", {
      hint: error.message
    });
  }
  if (Buffer.byteLength(canonicalJson(context)) > MAXIMUM_CONTEXT_BYTES) {
    throw new CliError("chapter context exceeds the supported local review size", {
      exitCode: EXIT.qualityGate,
      hint: "Use a shorter project clip. The transcript, alignment, and existing chapter drafts were preserved."
    });
  }
  const identity = {
    projectId: prepared.manifest.projectId,
    sourceAudioSha256: prepared.prepare.analysis.sha256,
    transcriptId: transcript.transcriptId,
    transcriptManifestSha256: transcript.manifestSha256,
    alignmentRevisionId: alignment.manifest.alignmentRevisionId,
    alignmentManifestSha256: alignment.manifestSha256,
    mode,
    context
  };
  const contextId = `chapter_context_${sha256(identity).slice(0, 24)}`;
  const body = {
    schemaVersion: CHAPTER_CONTEXT_ARTIFACT_SCHEMA,
    contextId,
    ...identity
  };
  return { ...body, manifestSha256: sha256(body) };
}

function validateContextArtifact(value, expected) {
  exactKeys(value, [
    "schemaVersion", "contextId", "projectId", "sourceAudioSha256", "transcriptId",
    "transcriptManifestSha256", "alignmentRevisionId", "alignmentManifestSha256",
    "mode", "context", "manifestSha256"
  ], "chapter context artifact");
  const { manifestSha256, ...body } = value;
  if (value.schemaVersion !== CHAPTER_CONTEXT_ARTIFACT_SCHEMA
      || !CONTEXT_ID.test(value.contextId) || !EXACT_DIGEST.test(manifestSha256)
      || manifestSha256 !== sha256(body)
      || (expected && canonicalJson(value) !== canonicalJson(expected))) {
    throw new CliError("chapter context artifact identity is invalid");
  }
  return value;
}

function emptyEdit(contextArtifact) {
  return {
    schemaVersion: CHAPTER_EDIT_SCHEMA,
    contextId: contextArtifact.contextId,
    contextManifestSha256: contextArtifact.manifestSha256,
    entries: []
  };
}

export function validateChapterEdit(value, contextArtifact, { requireComplete = false } = {}) {
  exactKeys(
    value,
    ["schemaVersion", "contextId", "contextManifestSha256", "entries"],
    "chapter edit"
  );
  if (value.schemaVersion !== CHAPTER_EDIT_SCHEMA
      || value.contextId !== contextArtifact.contextId
      || value.contextManifestSha256 !== contextArtifact.manifestSha256
      || !Array.isArray(value.entries)
      || value.entries.length > contextArtifact.context.policy.maximumChapters) {
    throw new CliError("chapter edit does not match the current aligned transcript", {
      exitCode: EXIT.usage,
      hint: "Reload Chapters before saving. Existing chapter drafts were preserved."
    });
  }
  const allowedAnchors = new Set(contextArtifact.context.windows.flatMap(({ records }) =>
    records.map(({ anchorId }) => anchorId)
  ));
  const usedAnchors = new Set();
  const entries = value.entries.map((entry, index) => {
    exactKeys(entry, ["anchorId", "title"], `chapter edit entry ${index + 1}`);
    if (typeof entry.anchorId !== "string"
        || !CANDIDATE_ID.test(entry.anchorId)
        || !allowedAnchors.has(entry.anchorId)
        || usedAnchors.has(entry.anchorId)
        || typeof entry.title !== "string"
        || [...entry.title].length > contextArtifact.context.policy.maximumTitleCharacters
        || CONTROL_OR_BIDI.test(entry.title)
        || entry.title.normalize("NFC") !== entry.title) {
      throw new CliError(`chapter edit entry ${index + 1} is invalid`, {
        exitCode: EXIT.usage,
        hint: "Use a supplied timestamp and a plain bounded title. Existing chapter drafts were preserved."
      });
    }
    usedAnchors.add(entry.anchorId);
    return { anchorId: entry.anchorId, title: entry.title };
  });
  if (requireComplete) {
    try {
      compileChapterEntries(entries, contextArtifact.context);
    } catch (error) {
      throw new CliError("chapter edit is not ready for approval", {
        exitCode: EXIT.reviewRequired,
        hint: `${error.message}. Your saved chapter draft was preserved.`
      });
    }
  }
  return { ...value, entries };
}

async function persistContext(projectRoot, contextArtifact) {
  const root = await chapterDirectory(projectRoot);
  const contexts = await childDirectory(root, "contexts");
  const contextPath = descendantPath(contexts, `${contextArtifact.contextId}.json`);
  await writeOrVerifyJson(contextPath, contextArtifact, "chapter context artifact");
  return { root, contextPath };
}

async function readApproved(root, contextArtifact) {
  const activePath = descendantPath(root, `active-${contextArtifact.mode}.json`);
  const pointer = await boundedJson(activePath, "active chapter pointer", { optional: true });
  if (!pointer) return null;
  exactKeys(pointer, [
    "schemaVersion", "mode", "chapterRevisionId", "revisionManifestSha256",
    "contextId", "contextManifestSha256"
  ], "active chapter pointer");
  if (pointer.schemaVersion !== ACTIVE_CHAPTERS_SCHEMA
      || pointer.mode !== contextArtifact.mode
      || !REVISION_ID.test(pointer.chapterRevisionId)
      || !EXACT_DIGEST.test(pointer.revisionManifestSha256)
      || !CONTEXT_ID.test(pointer.contextId)
      || !EXACT_DIGEST.test(pointer.contextManifestSha256)) {
    throw new CliError("active chapter pointer is invalid");
  }
  if (pointer.contextId !== contextArtifact.contextId
      || pointer.contextManifestSha256 !== contextArtifact.manifestSha256) {
    return null;
  }
  const revisions = await childDirectory(root, "revisions");
  const revision = await boundedJson(
    descendantPath(revisions, `${pointer.chapterRevisionId}-approved.json`),
    "approved chapter revision"
  );
  exactKeys(revision, [
    "schemaVersion", "chapterRevisionId", "contextId", "contextManifestSha256",
    "list", "manifestSha256"
  ], "approved chapter revision");
  const { manifestSha256, ...body } = revision;
  if (revision.schemaVersion !== APPROVED_CHAPTERS_SCHEMA
      || revision.chapterRevisionId !== pointer.chapterRevisionId
      || revision.contextId !== contextArtifact.contextId
      || revision.contextManifestSha256 !== contextArtifact.manifestSha256
      || manifestSha256 !== pointer.revisionManifestSha256
      || manifestSha256 !== sha256(body)) {
    throw new CliError("approved chapter revision identity is invalid");
  }
  try {
    validateChapterList(revision.list, contextArtifact.context);
  } catch (error) {
    throw new CliError("approved chapter revision failed the shared contract", {
      hint: error.message
    });
  }
  return revision;
}

export async function loadChapterWorkspace(projectPath, {
  mode = "topics",
  alignmentOptions
} = {}) {
  const aligned = await loadActiveAlignment(projectPath, alignmentOptions);
  const contextArtifact = validateContextArtifact(buildChapterContextArtifact({
    prepared: aligned,
    transcript: aligned.transcript,
    alignment: aligned.alignment,
    mode
  }));
  const { root, contextPath } = await persistContext(aligned.projectRoot, contextArtifact);
  const working = await childDirectory(root, "working");
  const workingPath = descendantPath(working, `${contextArtifact.contextId}.json`);
  const stored = await boundedJson(workingPath, "chapter working copy", { optional: true });
  const edit = stored ? validateChapterEdit(stored, contextArtifact) : emptyEdit(contextArtifact);
  const approved = await readApproved(root, contextArtifact);
  return {
    schemaVersion: CHAPTER_WORKSPACE_SCHEMA,
    projectRoot: aligned.projectRoot,
    contextPath,
    workingPath,
    contextArtifact,
    edit,
    approved
  };
}

export async function readChapterEditFile(inputPath, contextArtifact) {
  return validateChapterEdit(
    await boundedJson(inputPath, "chapter edit input"),
    contextArtifact
  );
}

export async function saveChapterWorkingCopy(projectPath, inputPath, options = {}) {
  const workspace = await loadChapterWorkspace(projectPath, options);
  const edit = await readChapterEditFile(inputPath, workspace.contextArtifact);
  await replaceJson(workspace.workingPath, edit, "chapter working copy");
  return { ...workspace, edit };
}

export async function approveChapterEdit(projectPath, inputPath, options = {}) {
  const workspace = await loadChapterWorkspace(projectPath, options);
  const edit = validateChapterEdit(
    await readChapterEditFile(inputPath, workspace.contextArtifact),
    workspace.contextArtifact,
    { requireComplete: true }
  );
  let list;
  try {
    list = compileChapterEntries(edit.entries, workspace.contextArtifact.context);
  } catch (error) {
    throw new CliError("chapter edit is not ready for approval", {
      exitCode: EXIT.reviewRequired,
      hint: `${error.message}. Your chapter draft was preserved.`
    });
  }
  const identity = {
    schemaVersion: APPROVED_CHAPTERS_SCHEMA,
    contextId: workspace.contextArtifact.contextId,
    contextManifestSha256: workspace.contextArtifact.manifestSha256,
    list
  };
  const chapterRevisionId = `chapters_${sha256(identity).slice(0, 24)}`;
  const body = { ...identity, chapterRevisionId };
  const approved = { ...body, manifestSha256: sha256(body) };
  const root = await chapterDirectory(workspace.projectRoot);
  const revisions = await childDirectory(root, "revisions");
  const revisionPath = descendantPath(revisions, `${chapterRevisionId}-approved.json`);
  await writeOrVerifyJson(revisionPath, approved, "approved chapter revision");
  await replaceJson(descendantPath(root, `active-${workspace.contextArtifact.mode}.json`), {
    schemaVersion: ACTIVE_CHAPTERS_SCHEMA,
    mode: workspace.contextArtifact.mode,
    chapterRevisionId,
    revisionManifestSha256: approved.manifestSha256,
    contextId: workspace.contextArtifact.contextId,
    contextManifestSha256: workspace.contextArtifact.manifestSha256
  }, "active chapter pointer");
  await replaceJson(workspace.workingPath, edit, "chapter working copy");
  return { ...approved, revisionPath };
}

export async function exportApprovedChapters(projectPath, {
  format = "youtube",
  mode = "topics",
  alignmentOptions
} = {}) {
  if (!["youtube", "markdown", "json"].includes(format)) {
    throw new CliError("--format must be youtube, markdown, or json", { exitCode: EXIT.usage });
  }
  const workspace = await loadChapterWorkspace(projectPath, { mode, alignmentOptions });
  if (!workspace.approved) {
    throw new CliError("approved chapters are required before export", {
      exitCode: EXIT.reviewRequired,
      hint: "Review and approve at least three chapters first. Existing chapter drafts were preserved."
    });
  }
  const formatters = {
    youtube: () => `${formatYouTubeChapters(workspace.approved.list)}\n`,
    markdown: () => `${formatMarkdownChapters(workspace.approved.list)}\n`,
    json: () => `${JSON.stringify(workspace.approved.list, null, 2)}\n`
  };
  const extensions = { youtube: "youtube.txt", markdown: "md", json: "json" };
  const content = formatters[format]();
  const root = await chapterDirectory(workspace.projectRoot);
  const exports = await childDirectory(root, "exports");
  const outputPath = descendantPath(
    exports,
    `${workspace.approved.chapterRevisionId}.${extensions[format]}`
  );
  await writeOrVerifyText(outputPath, content, "chapter export");
  return {
    format,
    outputPath,
    content,
    chapterRevisionId: workspace.approved.chapterRevisionId,
    manifestSha256: workspace.approved.manifestSha256
  };
}
