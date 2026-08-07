import fsp from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import {
  copyNewFile,
  descendantPath,
  hashFile,
  regularFile,
  safeNewProjectPath,
  writeNewJson
} from "./files.js";
import { parseClip } from "./time.js";

export const PROJECT_SCHEMA = "podcast-visualizer-project-v1";
export const PROJECT_FILE = "project.json";
export const PROJECT_STATES = Object.freeze([
  "initialized",
  "prepared",
  "analyzed",
  "review_required",
  "approved",
  "aligned",
  "render_ready",
  "rendered",
  "verified"
]);

const PROJECT_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "createdAt",
  "state",
  "source",
  "clip",
  "manifestSha256"
]);

export async function initializeProject({ source, project, clip }) {
  const input = await regularFile(source, "source media");
  const projectRoot = safeNewProjectPath(project);
  const clipWindow = parseClip(clip);
  const sourceExtension = path.extname(input.absolute).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(sourceExtension)) {
    throw new CliError("source media extension is unsupported", { exitCode: EXIT.usage });
  }

  try {
    await fsp.mkdir(projectRoot, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new CliError("project directory already exists", {
        exitCode: EXIT.usage,
        hint: "Choose a new --project path; existing projects are never overwritten."
      });
    }
    throw error;
  }

  try {
    const sourceDirectory = descendantPath(projectRoot, "source");
    await fsp.mkdir(sourceDirectory, { mode: 0o700 });
    const relativeSource = `source/original${sourceExtension}`;
    const copiedSource = descendantPath(projectRoot, relativeSource);
    await copyNewFile(input.absolute, copiedSource);
    const copiedStat = await fsp.stat(copiedSource);
    const sourceSha256 = await hashFile(copiedSource);
    const createdAt = new Date().toISOString();
    const projectId = `project_${sourceSha256.slice(0, 16)}_${createdAt.replace(/\D/g, "").slice(0, 14)}`;
    const body = {
      schemaVersion: PROJECT_SCHEMA,
      projectId,
      createdAt,
      state: "initialized",
      source: {
        relativePath: relativeSource,
        bytes: copiedStat.size,
        sha256: sourceSha256
      },
      clip: clipWindow
    };
    const manifest = { ...body, manifestSha256: sha256(body) };
    await writeNewJson(descendantPath(projectRoot, PROJECT_FILE), manifest);
    return { projectRoot, manifest };
  } catch (error) {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    throw error;
  }
}

export function validateProjectManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("project manifest must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!PROJECT_KEYS.has(key)) throw new CliError(`project manifest contains unknown field: ${key}`);
  }
  if (value.schemaVersion !== PROJECT_SCHEMA) throw new CliError("project schema is unsupported");
  if (!/^project_[a-f0-9]{16}_[0-9]{14}$/.test(value.projectId)) {
    throw new CliError("project ID is invalid");
  }
  if (!PROJECT_STATES.includes(value.state)) throw new CliError("project state is invalid");
  if (!value.source || typeof value.source !== "object") throw new CliError("project source is invalid");
  if (!/^source\/original\.[a-z0-9]{1,10}$/.test(value.source.relativePath)) {
    throw new CliError("project source path is invalid");
  }
  if (!Number.isSafeInteger(value.source.bytes) || value.source.bytes < 1) {
    throw new CliError("project source size is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(value.source.sha256)) throw new CliError("project source hash is invalid");
  const { startsAtMs, endsAtMs, durationMs } = value.clip ?? {};
  if (![startsAtMs, endsAtMs, durationMs].every(Number.isSafeInteger)
      || startsAtMs < 0 || endsAtMs <= startsAtMs || durationMs !== endsAtMs - startsAtMs) {
    throw new CliError("project clip is invalid");
  }
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("project manifest hash does not match");
  canonicalJson(value);
  return value;
}

export async function loadProject(projectPath) {
  const projectRoot = path.resolve(projectPath);
  const filePath = descendantPath(projectRoot, PROJECT_FILE);
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError("project manifest is not valid JSON");
    throw new CliError("project manifest could not be read", { hint: filePath });
  }
  const manifest = validateProjectManifest(parsed);
  const sourcePath = descendantPath(projectRoot, manifest.source.relativePath);
  const input = await regularFile(sourcePath, "project source media");
  if (input.stat.size !== manifest.source.bytes || await hashFile(sourcePath) !== manifest.source.sha256) {
    throw new CliError("project source media changed after initialization");
  }
  return { projectRoot, manifest, sourcePath };
}

