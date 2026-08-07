import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { validateBundledDiarizationModel } from "../src/models.js";
import {
  validateBundledAlignmentRuntime, validateBundledNodeRuntime,
  validateBundledRuntime, validateBundledSpeechRuntime
} from "../src/runtime.js";
import { writeSbom } from "./generate-sbom.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, "package.json"), "utf8"));
const releaseName = `podcast-visualizer-${pkg.version}-macos-arm64`;
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, releaseName);
const ARCHIVE = path.join(DIST, `${releaseName}.zip`);

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function copy(relative, destination = relative) {
  const source = path.join(ROOT, relative);
  const target = path.join(STAGE, destination);
  const stat = await fsp.lstat(source).catch(() => null);
  if (!stat || stat.isSymbolicLink()) throw new Error(`release input is missing or unsafe: ${relative}`);
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  await fsp.cp(source, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
}

if (pkg.version !== "0.1.0-rc.1") throw new Error("release version is not 0.1.0-rc.1");
await Promise.all([
  validateBundledRuntime(),
  validateBundledNodeRuntime(),
  validateBundledSpeechRuntime(),
  validateBundledAlignmentRuntime(),
  validateBundledDiarizationModel()
]);
for (const target of [STAGE, ARCHIVE, `${ARCHIVE}.sha256`]) {
  if (await fsp.lstat(target).catch(() => null)) throw new Error(`refusing to replace existing release output: ${target}`);
}
await fsp.mkdir(STAGE, { recursive: true, mode: 0o755 });

for (const relative of [
  "LICENSE", "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "package.json",
  "bin", "src", "review-ui", "docs", "licenses", "resources/fonts", "resources/model-manifests",
  "resources/runtime-manifests", "runtime", "scripts/fetch-alignment-model.mjs"
]) await copy(relative);
await copy("shared/dust-wave-platform/packages/timed-text", "node_modules/@dustwave/timed-text");
for (const relative of ["LICENSE", "README.md", "pyproject.toml", "uv.lock", "src"]) {
  await copy(`alignment-runner/${relative}`, `alignment-runner/${relative}`);
}
await writeSbom(path.join(STAGE, "SBOM.cdx.json"), STAGE);

const git = await run("/usr/bin/git", ["-C", ROOT, "rev-parse", "HEAD"]);
const componentManifests = {};
for (const relative of [
  "runtime/macos-arm64/manifest.json",
  "runtime/macos-arm64/node-manifest.json",
  "runtime/macos-arm64/speech-manifest.json",
  "runtime/macos-arm64/alignment-manifest.json",
  "resources/model-manifests/speaker-diarization-coreml.json",
  "resources/model-manifests/whisperx-en.json",
  "SBOM.cdx.json"
]) componentManifests[relative] = await hashFile(path.join(STAGE, relative));
const releaseManifest = {
  schemaVersion: "podcast-visualizer-release-v1",
  name: releaseName,
  version: pkg.version,
  platform: "macos-arm64",
  minimumMacOS: "26.0",
  gitRevision: git.stdout.trim(),
  builtAt: new Date().toISOString(),
  externalModels: ["parakeet-tdt-0.6b-v3", "WAV2VEC2_ASR_BASE_960H"],
  componentManifests
};
await fsp.writeFile(path.join(STAGE, "RELEASE-MANIFEST.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, {
  flag: "wx", mode: 0o644
});

const launcher = path.join(STAGE, "bin", "dustwave-video");
const help = await run(launcher, ["--help"], { cwd: STAGE, maxBuffer: 2 * 1024 * 1024 });
if (!help.stdout.startsWith("Podcast Visualizer")) throw new Error("packaged launcher smoke test failed");
let doctor;
try {
  doctor = await run(launcher, ["doctor", "--json"], { cwd: STAGE, timeout: 3 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
} catch (error) {
  doctor = error;
}
const doctorResult = JSON.parse(doctor.stdout || "null");
const failures = doctorResult?.checks?.filter((item) => !item.ok) || [];
if (failures.length !== 1 || failures[0].id !== "alignment-model") {
  throw new Error(`packaged doctor failed unexpectedly: ${JSON.stringify(failures)}`);
}

await run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", STAGE, ARCHIVE], {
  timeout: 60 * 60 * 1000,
  maxBuffer: 2 * 1024 * 1024
});
const archiveSha256 = await hashFile(ARCHIVE);
await fsp.writeFile(`${ARCHIVE}.sha256`, `${archiveSha256}  ${path.basename(ARCHIVE)}\n`, {
  flag: "wx", mode: 0o644
});
process.stdout.write(`${JSON.stringify({ stage: STAGE, archive: ARCHIVE, sha256: archiveSha256 }, null, 2)}\n`);
