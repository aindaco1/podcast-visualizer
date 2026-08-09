import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError, EXIT } from "./errors.js";
import { copyNewFile } from "./files.js";
import {
  DEFAULT_ALIGNMENT_MODEL_ROOT, DEFAULT_PARAKEET_MODEL_ROOT,
  loadExternalAlignmentManifest, validateBundledDiarizationModel, validateExternalAlignmentModel
} from "./models.js";
import { runProcess } from "./process.js";
import { defaultToolPath, validateBundledSpeechRuntime } from "./runtime.js";

const PARAKEET_SCHEMA = "podcast-visualizer-parakeet-manifest-v1";
const PARAKEET_MODEL = "parakeet-tdt-0.6b-v3-coreml";
const PARAKEET_FOLDER = "parakeet-tdt-0.6b-v3";
const PARAKEET_REVISION = "aed02740059203c4a87495924f685de3722ae9ce";
const DIGEST = /^[a-f0-9]{64}$/;
const PARAKEET_REPOSITORY = "FluidInference/parakeet-tdt-0.6b-v3-coreml";
const APPROVED_MODEL_HOSTS = new Set([
  "huggingface.co", "cdn-lfs.hf.co", "cas-bridge.xethub.hf.co", "download.pytorch.org"
]);

export const PARAKEET_MODEL_FILES = Object.freeze([
  { path: "Preprocessor.mlmodelc/coremldata.bin", bytes: 486, sha256: "dbde3f2300842c1fd51ef3ff948a0bcffe65ffd2dca10707f2509f32c1d65b1d" },
  { path: "Preprocessor.mlmodelc/metadata.json", bytes: 2_841, sha256: "2a98699e22d279dd37fa1d238aeb1c6db1df0d6fad687775324157689d8f3acf" },
  { path: "Preprocessor.mlmodelc/model.mil", bytes: 28_181, sha256: "4b8518a956450fec57f06c2a21bdffc26973f7f1fa6842fb38fe917f896b6b93" },
  { path: "Preprocessor.mlmodelc/weights/weight.bin", bytes: 491_072, sha256: "129b76e3aeafa8afa3ea76d995b964b145fe83700d579f6ff42c4c38fa0968ea" },
  { path: "Encoder.mlmodelc/coremldata.bin", bytes: 485, sha256: "d48034a167a82e88fc3df64f60af963ab3983538271175b8319e7d5720a0fb86" },
  { path: "Encoder.mlmodelc/metadata.json", bytes: 2_921, sha256: "da24da9cca943fb29d7fa8e376d57fca7cb3aa08ca51b956b0b0e56813f087e9" },
  { path: "Encoder.mlmodelc/model.mil", bytes: 959_769, sha256: "ed7b19156ca29fa7dfd6891deb9fda4b0e8893f68597c985d135736546a43808" },
  { path: "Encoder.mlmodelc/weights/weight.bin", bytes: 445_187_200, sha256: "e2020f323703477a5b21d7c2d282c403e371afb5962e79877e3033e73ba6f421" },
  { path: "Decoder.mlmodelc/coremldata.bin", bytes: 554, sha256: "18647af085d87bd8f3121c8a9b4d4564c1ede038dab63d295b4e745cf2d7fb99" },
  { path: "Decoder.mlmodelc/metadata.json", bytes: 3_427, sha256: "a39e93cd8371b8ded92635c7804fcd0590f0d1dd9415c6d19a0484be073077d9" },
  { path: "Decoder.mlmodelc/model.mil", bytes: 13_110, sha256: "ef2a0a281695398a62fde86ac269c68f73d5b578d7ed3b31f2ba91a2d1ea1f35" },
  { path: "Decoder.mlmodelc/weights/weight.bin", bytes: 23_604_992, sha256: "48adf0f0d47c406c8253d4f7fef967436a39da14f5a65e66d5a4b407be355d41" },
  { path: "JointDecisionv3.mlmodelc/coremldata.bin", bytes: 521, sha256: "f5fc08b741400f0088492c9e839418b1e18522f19cba28d361dd030c5f398342" },
  { path: "JointDecisionv3.mlmodelc/metadata.json", bytes: 3_453, sha256: "d9307211b9a37e0f0ac260c7660b1571a3de25841035cfdf9b58fd40425f890f" },
  { path: "JointDecisionv3.mlmodelc/model.mil", bytes: 11_775, sha256: "be60732943389a047175111a83f8839f3eb39d4803adafa828a0871b2f39818d" },
  { path: "JointDecisionv3.mlmodelc/weights/weight.bin", bytes: 12_642_764, sha256: "4e0e63d840032f7f07ddb1d64446051166281e5491bf22da8a945c41f6eedb3e" },
  { path: "parakeet_vocab.json", bytes: 151_122, sha256: "7ec60e05f1b24480736ec0eed40900f4626bce1fa9a60fd700ec7e2a59198735" }
].map(Object.freeze));

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
  for (const [index, file] of value.files.entries()) {
    const expected = PARAKEET_MODEL_FILES[index];
    if (!file || typeof file !== "object" || Array.isArray(file)
        || Object.keys(file).some((key) => !["path", "bytes", "sha256"].includes(key))
        || typeof file.path !== "string" || seen.has(file.path)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 1024 * 1024 * 1024
        || !DIGEST.test(file.sha256) || file.path !== expected.path
        || file.bytes !== expected.bytes || file.sha256 !== expected.sha256) {
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

function approvedModelURL(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new CliError("model download returned an invalid URL", { exitCode: EXIT.modelMissing });
  }
  const approvedHost = APPROVED_MODEL_HOSTS.has(url.hostname) || url.hostname.endsWith(".hf.co");
  if (url.protocol !== "https:" || url.username || url.password
      || (url.port && url.port !== "443") || !approvedHost) {
    throw new CliError("model download redirected to an unapproved host", { exitCode: EXIT.modelMissing });
  }
  return url;
}

function downloadPath(base, relativePath) {
  safeManifestPath("/model", relativePath);
  return `${base}${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function writeDownloadedFile({ response, target, file, progress }) {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined
      && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) !== file.bytes)) {
    throw new CliError("model download size does not match the pinned manifest", { exitCode: EXIT.modelMissing });
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    throw new CliError("model download returned no file data", { exitCode: EXIT.modelMissing });
  }
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const hash = createHash("sha256");
  let bytes = 0;
  let handle;
  try {
    handle = await fsp.open(target, "wx", 0o600);
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > file.bytes) {
        throw new CliError("model download exceeded its pinned size", { exitCode: EXIT.modelMissing });
      }
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
        if (bytesWritten < 1) throw new CliError("model download could not be written");
        offset += bytesWritten;
      }
      await progress(chunk.length);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
  if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) {
    throw new CliError("model download failed SHA-256 verification", { exitCode: EXIT.modelMissing });
  }
}

export async function downloadVerifiedModel({
  destination, files, verify, label, fetcher = fetch, onProgress = async () => {}, signal
}) {
  const destinationRoot = path.resolve(destination);
  const filesystemRoot = path.parse(destinationRoot).root;
  if (!Array.isArray(files) || files.length < 1 || files.length > 64
      || destinationRoot === filesystemRoot || destinationRoot === path.resolve(os.homedir())) {
    throw new CliError(`${label} download contract is unsafe`, { exitCode: EXIT.usage });
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)
        || Object.keys(file).some((key) => !["path", "bytes", "sha256", "url"].includes(key))
        || typeof file.path !== "string" || seen.has(file.path)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 1024 * 1024 * 1024
        || !DIGEST.test(file.sha256)) {
      throw new CliError(`${label} download manifest is invalid`, { exitCode: EXIT.modelMissing });
    }
    safeManifestPath("/model", file.path);
    approvedModelURL(file.url);
    seen.add(file.path);
    totalBytes += file.bytes;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes > 1024 * 1024 * 1024) {
    throw new CliError(`${label} download is larger than its safety limit`, { exitCode: EXIT.modelMissing });
  }

  const parent = path.dirname(destinationRoot);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await fsp.lstat(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new CliError(`${label} destination is unsafe`);
  }
  const volume = await fsp.statfs(parent);
  const availableBytes = volume.bavail * volume.bsize;
  const requiredBytes = totalBytes + 64 * 1024 * 1024;
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    throw new CliError(`${label} download needs more available disk space`, { exitCode: EXIT.modelMissing });
  }
  const existing = await fsp.lstat(destinationRoot).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new CliError(`existing ${label} destination is unsafe; move it aside before downloading`);
    }
    try {
      const verified = await verify(destinationRoot);
      return { ...verified, destination: destinationRoot, reused: true };
    } catch {
      throw new CliError(`existing ${label} destination is not verified; move it aside before downloading`, {
        exitCode: EXIT.modelMissing
      });
    }
  }

  const lock = `${destinationRoot}.download-lock`;
  let staging;
  try {
    await fsp.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new CliError(`another ${label} download is already running`);
    throw error;
  }
  let completedBytes = 0;
  let reportedBytes = 0;
  const reportInterval = Math.max(1024 * 1024, Math.ceil(totalBytes / 400));
  const timeoutSignal = AbortSignal.timeout(2 * 60 * 60 * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    staging = await fsp.mkdtemp(path.join(parent, `.${path.basename(destinationRoot)}.download-`));
    await fsp.chmod(staging, 0o700);
    await onProgress({ phase: "downloading-model", fraction: 0 });
    for (const file of files) {
      let response;
      try {
        response = await fetcher(file.url, { redirect: "follow", signal: requestSignal });
      } catch {
        throw new CliError(`${label} download failed`, { exitCode: EXIT.modelMissing });
      }
      approvedModelURL(response.url || file.url);
      if (!response.ok) {
        throw new CliError(`${label} download failed (${response.status})`, { exitCode: EXIT.modelMissing });
      }
      const target = safeManifestPath(staging, file.path);
      await writeDownloadedFile({
        response,
        target,
        file,
        progress: async (bytes) => {
          completedBytes += bytes;
          if (completedBytes - reportedBytes >= reportInterval || completedBytes === totalBytes) {
            reportedBytes = completedBytes;
            await onProgress({ phase: "downloading-model", fraction: completedBytes / totalBytes });
          }
        }
      });
    }
    await onProgress({ phase: "verifying-model" });
    const verified = await verify(staging);
    if (await fsp.lstat(destinationRoot).catch(() => null)) {
      throw new CliError(`${label} destination appeared during download; refusing to replace it`);
    }
    await fsp.rename(staging, destinationRoot);
    staging = undefined;
    await onProgress({ phase: "installing-model", fraction: 1 });
    return { ...verified, destination: destinationRoot, reused: false };
  } finally {
    if (staging) await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rmdir(lock).catch(() => {});
  }
}

export async function downloadParakeetModel({
  destination = DEFAULT_PARAKEET_MODEL_ROOT,
  verify = verifyParakeetModel,
  fetcher = fetch,
  onProgress,
  signal
} = {}) {
  const base = `https://huggingface.co/${PARAKEET_REPOSITORY}/resolve/${PARAKEET_REVISION}/`;
  const files = PARAKEET_MODEL_FILES.map((file) => ({
    ...file, url: downloadPath(base, file.path)
  }));
  return await downloadVerifiedModel({
    destination, files, verify, label: "Parakeet model", fetcher, onProgress, signal
  });
}

export async function downloadAlignmentModel({
  destination = DEFAULT_ALIGNMENT_MODEL_ROOT,
  verify = validateExternalAlignmentModel,
  fetcher = fetch,
  onProgress,
  signal
} = {}) {
  const manifest = await loadExternalAlignmentManifest();
  const files = manifest.files.map((file) => ({ ...file, url: manifest.source.url }));
  return await downloadVerifiedModel({
    destination, files, verify, label: "alignment model", fetcher, onProgress, signal
  });
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
