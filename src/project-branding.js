import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { copyNewFile, descendantPath, hashFile, regularFile } from "./files.js";
import { loadProject } from "./project.js";
import { runProcess } from "./process.js";
import { defaultToolPath } from "./runtime.js";

export const PROJECT_BRANDING_EDIT_SCHEMA = "podcast-visualizer-project-branding-edit-v1";
export const PROJECT_BRANDING_SCHEMA = "podcast-visualizer-project-branding-v1";
export const PROJECT_BRANDING_WORKSPACE_SCHEMA = "podcast-visualizer-project-branding-workspace-v1";

const MAXIMUM_EDIT_BYTES = 64 * 1024;
const MAXIMUM_LOGO_BYTES = 10 * 1024 * 1024;
const MINIMUM_LOGO_DIMENSION = 128;
const MAXIMUM_LOGO_DIMENSION = 4096;
const DIGEST = /^[a-f0-9]{64}$/;
const LOGO_RELATIVE_PATH = /^branding\/assets\/logo_[a-f0-9]{64}\.png$/;
const SETTINGS_KEYS = new Set([
  "schemaVersion", "podcastName", "organizationName", "showSpeakerNames",
  "logo", "savedAt", "manifestSha256"
]);
const LOGO_KEYS = new Set(["relativePath", "bytes", "sha256", "width", "height"]);
const EDIT_KEYS = new Set([
  "schemaVersion", "podcastName", "organizationName", "showSpeakerNames", "logoAction"
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

function validateDisplayText(value, label) {
  if (typeof value !== "string" || value !== value.normalize("NFC").trim()
      || [...value].length < 1 || [...value].length > 120
      || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new CliError(`${label} is invalid`);
  }
  return value;
}

function parsePngHeader(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)
      || buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new CliError("podcast logo must be a valid PNG image", { exitCode: EXIT.usage });
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (![width, height].every(Number.isSafeInteger)
      || width < MINIMUM_LOGO_DIMENSION || height < MINIMUM_LOGO_DIMENSION
      || width > MAXIMUM_LOGO_DIMENSION || height > MAXIMUM_LOGO_DIMENSION) {
    throw new CliError("podcast logo dimensions must be between 128 and 4096 pixels", {
      exitCode: EXIT.usage
    });
  }
  return { width, height };
}

async function probePng(sourcePath, expected) {
  const result = await runProcess(defaultToolPath("ffprobe"), [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
    "-of", "json", sourcePath
  ], {
    label: "podcast logo probe",
    timeoutMs: 10_000,
    maximumOutputBytes: 64 * 1024
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new CliError("podcast logo could not be decoded as PNG", { exitCode: EXIT.usage });
  }
  const [stream] = parsed.streams ?? [];
  if (!stream || parsed.streams.length !== 1 || stream.codec_name !== "png"
      || stream.width !== expected.width || stream.height !== expected.height) {
    throw new CliError("podcast logo could not be decoded as PNG", { exitCode: EXIT.usage });
  }
}

async function parseBoundedJson(inputPath, label) {
  if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) {
    throw new CliError("--input must be an absolute file path", { exitCode: EXIT.usage });
  }
  const input = await regularFile(path.resolve(inputPath), label);
  if (input.stat.size > MAXIMUM_EDIT_BYTES) {
    throw new CliError(`${label} is outside the supported size`, { exitCode: EXIT.usage });
  }
  try {
    return JSON.parse(await fsp.readFile(input.absolute, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`, { exitCode: EXIT.usage });
  }
}

async function safeDirectory(projectRoot, name, { create = false } = {}) {
  const directory = descendantPath(projectRoot, name);
  if (create) {
    await fsp.mkdir(directory, { recursive: false, mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
  }
  const stat = await fsp.lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError(`project ${name} directory is unsafe`);
  }
  return directory;
}

function validateLogoDescriptor(value) {
  exactKeys(value, LOGO_KEYS, "project branding logo");
  if (!LOGO_RELATIVE_PATH.test(value.relativePath)
      || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAXIMUM_LOGO_BYTES
      || !DIGEST.test(value.sha256)
      || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
      || value.width < MINIMUM_LOGO_DIMENSION || value.height < MINIMUM_LOGO_DIMENSION
      || value.width > MAXIMUM_LOGO_DIMENSION || value.height > MAXIMUM_LOGO_DIMENSION) {
    throw new CliError("project branding logo is invalid");
  }
  return value;
}

function validateSettings(value) {
  exactKeys(value, SETTINGS_KEYS, "project branding settings");
  if (value.schemaVersion !== PROJECT_BRANDING_SCHEMA
      || typeof value.showSpeakerNames !== "boolean"
      || Number.isNaN(Date.parse(value.savedAt))
      || !DIGEST.test(value.manifestSha256)) {
    throw new CliError("project branding settings are invalid");
  }
  validateDisplayText(value.podcastName, "podcast name");
  validateDisplayText(value.organizationName, "organization name");
  if (value.logo !== null) validateLogoDescriptor(value.logo);
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) {
    throw new CliError("project branding settings hash does not match");
  }
  return value;
}

function validateEdit(value) {
  exactKeys(value, EDIT_KEYS, "project branding edit");
  if (value.schemaVersion !== PROJECT_BRANDING_EDIT_SCHEMA
      || typeof value.showSpeakerNames !== "boolean") {
    throw new CliError("project branding edit is invalid");
  }
  validateDisplayText(value.podcastName, "podcast name");
  validateDisplayText(value.organizationName, "organization name");
  if (!value.logoAction || typeof value.logoAction !== "object" || Array.isArray(value.logoAction)) {
    throw new CliError("project branding logo action is invalid");
  }
  const action = value.logoAction.action;
  const allowed = action === "replace" ? new Set(["action", "sourcePath"]) : new Set(["action"]);
  exactKeys(value.logoAction, allowed, "project branding logo action");
  if (!["keep", "remove", "replace"].includes(action)
      || (action === "replace" && (typeof value.logoAction.sourcePath !== "string"
        || !path.isAbsolute(value.logoAction.sourcePath)))) {
    throw new CliError("project branding logo action is invalid");
  }
  return value;
}

async function verifyStoredLogo(projectRoot, logo) {
  validateLogoDescriptor(logo);
  const absolute = descendantPath(projectRoot, logo.relativePath);
  const file = await regularFile(absolute, "project branding logo");
  if (file.stat.size !== logo.bytes || await hashFile(absolute) !== logo.sha256) {
    throw new CliError("project branding logo changed after import");
  }
  const dimensions = parsePngHeader(await fsp.readFile(absolute));
  if (dimensions.width !== logo.width || dimensions.height !== logo.height) {
    throw new CliError("project branding logo dimensions changed after import");
  }
  return absolute;
}

function workspace(projectRoot, settings, logoPath, hasSavedSettings) {
  return {
    schemaVersion: PROJECT_BRANDING_WORKSPACE_SCHEMA,
    projectRoot,
    podcastName: settings.podcastName,
    organizationName: settings.organizationName,
    showSpeakerNames: settings.showSpeakerNames,
    logo: settings.logo === null ? null : { ...settings.logo, path: logoPath },
    hasSavedSettings
  };
}

export function defaultProjectBranding() {
  return {
    podcastName: "Dust Wave Podcast",
    organizationName: "Dust Wave",
    showSpeakerNames: true,
    logo: null
  };
}

export async function loadProjectBranding(projectPath) {
  const project = await loadProject(projectPath);
  const directory = await safeDirectory(project.projectRoot, "branding");
  if (!directory) return workspace(project.projectRoot, defaultProjectBranding(), null, false);
  const settingsPath = descendantPath(directory, "settings.json");
  const stat = await fsp.lstat(settingsPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return workspace(project.projectRoot, defaultProjectBranding(), null, false);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAXIMUM_EDIT_BYTES) {
    throw new CliError("project branding settings are unsafe");
  }
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
  } catch {
    throw new CliError("project branding settings are not valid JSON");
  }
  const settings = validateSettings(parsed);
  const logoPath = settings.logo === null ? null : await verifyStoredLogo(project.projectRoot, settings.logo);
  return workspace(project.projectRoot, settings, logoPath, true);
}

async function importLogo(projectRoot, sourcePath) {
  const source = await regularFile(sourcePath, "podcast logo");
  if (source.stat.size > MAXIMUM_LOGO_BYTES || path.extname(source.absolute).toLowerCase() !== ".png") {
    throw new CliError("podcast logo must be a PNG no larger than 10 MiB", { exitCode: EXIT.usage });
  }
  const dimensions = parsePngHeader(await fsp.readFile(source.absolute));
  await probePng(source.absolute, dimensions);
  const digest = await hashFile(source.absolute);
  const brandingDirectory = await safeDirectory(projectRoot, "branding", { create: true });
  const assetsDirectory = descendantPath(brandingDirectory, "assets");
  await fsp.mkdir(assetsDirectory, { recursive: false, mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const assetsStat = await fsp.lstat(assetsDirectory);
  if (assetsStat.isSymbolicLink() || !assetsStat.isDirectory()) {
    throw new CliError("project branding assets directory is unsafe");
  }
  const relativePath = `branding/assets/logo_${digest}.png`;
  const destination = descendantPath(projectRoot, relativePath);
  const existing = await fsp.lstat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()
        || existing.size !== source.stat.size || await hashFile(destination) !== digest) {
      throw new CliError("existing project branding logo is unsafe");
    }
  } else {
    await copyNewFile(source.absolute, destination);
  }
  return {
    relativePath,
    bytes: source.stat.size,
    sha256: digest,
    ...dimensions
  };
}

export async function saveProjectBranding({ projectPath, inputPath, savedAt = new Date().toISOString() }) {
  const current = await loadProjectBranding(projectPath);
  const edit = validateEdit(await parseBoundedJson(inputPath, "project branding edit input"));
  if (Number.isNaN(Date.parse(savedAt))) throw new CliError("project branding timestamp is invalid");
  let logo = current.logo === null ? null : {
    relativePath: current.logo.relativePath,
    bytes: current.logo.bytes,
    sha256: current.logo.sha256,
    width: current.logo.width,
    height: current.logo.height
  };
  if (edit.logoAction.action === "remove") logo = null;
  if (edit.logoAction.action === "replace") {
    logo = await importLogo(current.projectRoot, edit.logoAction.sourcePath);
  }
  const body = {
    schemaVersion: PROJECT_BRANDING_SCHEMA,
    podcastName: edit.podcastName,
    organizationName: edit.organizationName,
    showSpeakerNames: edit.showSpeakerNames,
    logo,
    savedAt
  };
  const settings = { ...body, manifestSha256: sha256(body) };
  const directory = await safeDirectory(current.projectRoot, "branding", { create: true });
  const target = descendantPath(directory, "settings.json");
  const existing = await fsp.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new CliError("project branding settings are unsafe");
  }
  const temporary = descendantPath(directory, `.settings-${randomBytes(6).toString("hex")}.json`);
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fsp.rename(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
  const logoPath = logo === null ? null : await verifyStoredLogo(current.projectRoot, logo);
  return workspace(current.projectRoot, settings, logoPath, true);
}

export const __test = Object.freeze({ parsePngHeader, validateEdit, validateSettings });
