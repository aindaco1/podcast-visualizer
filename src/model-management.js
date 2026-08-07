import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError, EXIT } from "./errors.js";
import { copyNewFile } from "./files.js";
import {
  DEFAULT_ALIGNMENT_MODEL_ROOT, DEFAULT_PARAKEET_MODEL_ROOT,
  validateBundledDiarizationModel, validateExternalAlignmentModel
} from "./models.js";
import { runProcess } from "./process.js";
import { defaultToolPath, validateBundledSpeechRuntime } from "./runtime.js";

const PARAKEET_SCHEMA = "podcast-visualizer-parakeet-manifest-v1";
const PARAKEET_MODEL = "parakeet-tdt-0.6b-v3-coreml";
const PARAKEET_FOLDER = "parakeet-tdt-0.6b-v3";
const PARAKEET_REVISION = "aed02740059203c4a87495924f685de3722ae9ce";
const DIGEST = /^[a-f0-9]{64}$/;

async function requireRealDirectory(input, label) {
  const resolved = path.resolve(String(input ?? ""));
  const stat = await fsp.lstat(resolved).catch(() => null);
  if (!input || !stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError(`${label} must be a real directory, not a symlink`, { exitCode: EXIT.modelMissing });
  }
  return resolved;
}

function safeManifestPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")
      || path.posix.normalize(relativePath) !== relativePath || path.posix.isAbsolute(relativePath)
      || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CliError("model manifest contains an unsafe path", { exitCode: EXIT.modelMissing });
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new CliError("model manifest path escapes its root", { exitCode: EXIT.modelMissing });
  }
  return target;
}

export function validateParakeetEvidence(value) {
  const keys = new Set(["schemaVersion", "model", "sourceRevision", "localFolderName", "files"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.has(key))
      || value.schemaVersion !== PARAKEET_SCHEMA || value.model !== PARAKEET_MODEL
      || value.sourceRevision !== PARAKEET_REVISION || value.localFolderName !== PARAKEET_FOLDER
      || !Array.isArray(value.files) || value.files.length !== 17) {
    throw new CliError("Parakeet verifier returned an invalid manifest", { exitCode: EXIT.modelMissing });
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const file of value.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)
        || Object.keys(file).some((key) => !["path", "bytes", "sha256"].includes(key))
        || typeof file.path !== "string" || seen.has(file.path)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 1024 * 1024 * 1024
        || !DIGEST.test(file.sha256)) {
      throw new CliError("Parakeet verifier returned invalid file evidence", { exitCode: EXIT.modelMissing });
    }
    safeManifestPath("/model", file.path);
    seen.add(file.path);
    totalBytes += file.bytes;
  }
  if (totalBytes < 400 * 1024 * 1024 || totalBytes > 1024 * 1024 * 1024) {
    throw new CliError("Parakeet verifier returned an unexpected model size", { exitCode: EXIT.modelMissing });
  }
  return value;
}

export async function verifyParakeetModel(modelRoot, {
  speechPath = defaultToolPath("speech"),
  validateRuntime = validateBundledSpeechRuntime,
  runner = runProcess
} = {}) {
  const resolvedRoot = await requireRealDirectory(modelRoot, "Parakeet model");
  await validateRuntime();
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-parakeet-"));
  const output = path.join(temporaryDirectory, "manifest.json");
  try {
    await runner(speechPath, ["verify-parakeet", "--model", resolvedRoot, "--output", output], {
      label: "Parakeet model verification",
      timeoutMs: 10 * 60 * 1000,
      maximumOutputBytes: 512 * 1024
    });
    const stat = await fsp.lstat(output).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 256 * 1024) {
      throw new CliError("Parakeet verifier did not return safe evidence", { exitCode: EXIT.modelMissing });
    }
    return { manifest: validateParakeetEvidence(JSON.parse(await fsp.readFile(output, "utf8"))), modelRoot: resolvedRoot };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError("Parakeet verifier returned malformed evidence", { exitCode: EXIT.modelMissing });
    }
    throw error;
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function requireSafeSourceFile(root, file) {
  const target = safeManifestPath(root, file.path);
  let current = path.resolve(root);
  for (const component of file.path.split("/")) {
    current = path.join(current, component);
    const stat = await fsp.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) throw new CliError(`model source contains an unsafe path: ${file.path}`);
  }
  const stat = await fsp.lstat(target);
  if (!stat.isFile() || stat.size !== file.bytes) {
    throw new CliError(`model source changed during import: ${file.path}`, { exitCode: EXIT.modelMissing });
  }
  return target;
}

async function copyManifestFiles(source, staging, files) {
  for (const file of files) {
    const input = await requireSafeSourceFile(source, file);
    const output = safeManifestPath(staging, file.path);
    await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await copyNewFile(input, output);
  }
}

async function importVerifiedModel({ source, destination, verify, label }) {
  const sourceRoot = await requireRealDirectory(source, `${label} source`);
  const sourceResult = await verify(sourceRoot);
  const destinationRoot = path.resolve(destination);
  const parent = path.dirname(destinationRoot);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await fsp.lstat(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new CliError(`${label} destination is unsafe`);

  const existing = await fsp.lstat(destinationRoot).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new CliError(`existing ${label} destination is unsafe; move it aside before importing`);
    }
    try {
      const verified = await verify(destinationRoot);
      return { ...verified, destination: destinationRoot, reused: true };
    } catch {
      throw new CliError(`existing ${label} destination is not verified; move it aside before importing`, {
        exitCode: EXIT.modelMissing
      });
    }
  }

  const lock = `${destinationRoot}.import-lock`;
  let staging;
  try {
    await fsp.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new CliError(`another ${label} import is already running`);
    throw error;
  }
  try {
    if (await fsp.lstat(destinationRoot).catch(() => null)) {
      throw new CliError(`${label} destination appeared during import; refusing to replace it`);
    }
    staging = await fsp.mkdtemp(path.join(parent, `.${path.basename(destinationRoot)}.import-`));
    await fsp.chmod(staging, 0o700);
    await copyManifestFiles(sourceRoot, staging, sourceResult.manifest.files);
    const staged = await verify(staging);
    if (await fsp.lstat(destinationRoot).catch(() => null)) {
      throw new CliError(`${label} destination appeared during import; refusing to replace it`);
    }
    await fsp.rename(staging, destinationRoot);
    staging = undefined;
    return { ...staged, destination: destinationRoot, reused: false };
  } finally {
    if (staging) await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rmdir(lock).catch(() => {});
  }
}

export async function importParakeetModel(source, {
  destination = DEFAULT_PARAKEET_MODEL_ROOT,
  verify = verifyParakeetModel
} = {}) {
  return await importVerifiedModel({ source, destination, verify, label: "Parakeet model" });
}

export async function importAlignmentModel(source, {
  destination = DEFAULT_ALIGNMENT_MODEL_ROOT,
  verify = validateExternalAlignmentModel
} = {}) {
  return await importVerifiedModel({ source, destination, verify, label: "alignment model" });
}

async function statusCheck(id, modelRoot, operation, detail) {
  try {
    const result = await operation();
    return { id, ok: true, modelRoot, detail: detail(result) };
  } catch (error) {
    return { id, ok: false, modelRoot, detail: error.message };
  }
}

export async function modelStatus({
  parakeetModelRoot = process.env.PODCAST_VISUALIZER_PARAKEET_MODEL || DEFAULT_PARAKEET_MODEL_ROOT,
  alignmentModelRoot = DEFAULT_ALIGNMENT_MODEL_ROOT
} = {}) {
  const checks = [];
  checks.push(await statusCheck("parakeet-v3", path.resolve(parakeetModelRoot),
    () => verifyParakeetModel(parakeetModelRoot),
    ({ manifest }) => `${manifest.model} ${manifest.sourceRevision.slice(0, 12)}`));
  checks.push(await statusCheck("align-en", path.resolve(alignmentModelRoot),
    () => validateExternalAlignmentModel(alignmentModelRoot),
    ({ manifest }) => `${manifest.model} ${manifest.modelVersion.slice(0, 12)}`));
  checks.push(await statusCheck("diarization", null,
    () => validateBundledDiarizationModel(),
    ({ manifest }) => `${manifest.model} ${manifest.source.revision.slice(0, 12)}`));
  return { ok: checks.every((check) => check.ok), checks };
}
