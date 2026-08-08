import fsp from "node:fs/promises";

import { CliError } from "./errors.js";
import { descendantPath } from "./files.js";
import { resolveActiveTranscript } from "./review-revisions.js";

const MAXIMUM_STAGE_ENTRIES = 10_000;
const MAXIMUM_STAGE_JSON_BYTES = 16 * 1024 * 1024;

async function regularMarker(projectRoot, ...segments) {
  const marker = descendantPath(projectRoot, ...segments);
  const stat = await fsp.lstat(marker).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CliError(`project stage marker is unsafe: ${segments.join("/")}`);
  }
  return true;
}

async function matchingMarker(projectRoot, directoryName, pattern) {
  const directory = descendantPath(projectRoot, directoryName);
  const stat = await fsp.lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError(`project stage directory is unsafe: ${directoryName}`);
  }
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  if (entries.length > MAXIMUM_STAGE_ENTRIES) {
    throw new CliError(`project stage directory has too many entries: ${directoryName}`);
  }
  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: ${directoryName}/${entry.name}`);
    }
    return true;
  }
  return false;
}

async function boundedJson(filePath, label) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()
      || stat.size < 1 || stat.size > MAXIMUM_STAGE_JSON_BYTES) {
    throw new CliError(`${label} is missing or unsafe`);
  }
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

async function safeDirectoryEntries(projectRoot, name) {
  const directory = descendantPath(projectRoot, name);
  const stat = await fsp.lstat(directory).catch(() => null);
  if (!stat) return { directory, entries: [] };
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError(`project stage directory is unsafe: ${name}`);
  }
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  if (entries.length > MAXIMUM_STAGE_ENTRIES) {
    throw new CliError(`project stage directory has too many entries: ${name}`);
  }
  return { directory, entries };
}

async function activeAlignmentIds(projectRoot, transcript) {
  const { directory, entries } = await safeDirectoryEntries(projectRoot, "alignment");
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const ids = new Set();
  for (const entry of entries) {
    const match = /^(alignment_[a-f0-9]{24})-request\.json$/.exec(entry.name);
    if (!match) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: alignment/${entry.name}`);
    }
    const request = await boundedJson(
      descendantPath(directory, entry.name),
      "alignment request"
    );
    if (request.alignmentRevisionId !== match[1]
        || request.transcript?.contentSha256 !== transcript.contentSha256
        || request.transcript?.projectionSha256 !== transcript.projection.projectionSha256) {
      continue;
    }
    const qualityName = `${match[1]}-quality.json`;
    const qualityEntry = entriesByName.get(qualityName);
    if (!qualityEntry) continue;
    if (!qualityEntry.isFile() || qualityEntry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: alignment/${qualityName}`);
    }
    const quality = await boundedJson(
      descendantPath(directory, qualityName),
      "alignment quality"
    );
    if (quality.alignmentRevisionId === match[1]) ids.add(match[1]);
  }
  return ids;
}

async function hasActiveRender(projectRoot, transcript, alignmentIds) {
  if (alignmentIds.size === 0) return false;
  const scenes = await safeDirectoryEntries(projectRoot, "scenes");
  const sceneDigests = new Map();
  for (const entry of scenes.entries) {
    const match = /^(scene_[a-f0-9]{24})\.json$/.exec(entry.name);
    if (!match) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: scenes/${entry.name}`);
    }
    const scene = await boundedJson(descendantPath(scenes.directory, entry.name), "scene manifest");
    if (scene.sceneId === match[1]
        && scene.inputs?.transcriptId === transcript.transcriptId
        && scene.inputs?.transcriptManifestSha256 === transcript.manifestSha256
        && alignmentIds.has(scene.inputs?.alignmentRevisionId)
        && /^[a-f0-9]{64}$/.test(String(scene.manifestSha256))) {
      sceneDigests.set(scene.sceneId, scene.manifestSha256);
    }
  }
  if (sceneDigests.size === 0) return false;
  const renders = await safeDirectoryEntries(projectRoot, "renders");
  for (const entry of renders.entries) {
    if (!/^render_[a-f0-9]{24}\.json$/.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: renders/${entry.name}`);
    }
    const render = await boundedJson(descendantPath(renders.directory, entry.name), "render manifest");
    if (sceneDigests.get(render.sceneId) === render.sceneManifestSha256) return true;
  }
  return false;
}

export async function detectProjectStage(projectRoot, { projectId } = {}) {
  const hasApproved = await matchingMarker(
    projectRoot,
    "review",
    /^transcript_[a-f0-9]{24}-approved\.json$/
  );
  if (hasApproved && projectId) {
    const active = await resolveActiveTranscript({ projectRoot, projectId });
    const alignmentIds = await activeAlignmentIds(projectRoot, active.transcript);
    if (await hasActiveRender(projectRoot, active.transcript, alignmentIds)) return "verified";
    if (alignmentIds.size > 0) return "aligned";
    return "approved";
  }
  if (await matchingMarker(projectRoot, "renders", /^render_[a-f0-9]{24}\.json$/)) return "verified";
  if (await matchingMarker(projectRoot, "alignment", /^alignment_[a-f0-9]{24}-quality\.json$/)) return "aligned";
  if (hasApproved) return "approved";
  if (await regularMarker(projectRoot, "review", "draft.json")) return "review_required";
  if (await regularMarker(projectRoot, "prepare.json")) return "prepared";
  return "initialized";
}
