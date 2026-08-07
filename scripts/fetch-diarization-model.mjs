import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(ROOT, "resources", "model-manifests", "speaker-diarization-coreml.json");
const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
const destination = path.join(ROOT, "runtime", "macos-arm64", "models", manifest.model);
const base = `https://huggingface.co/${manifest.source.repository}/resolve/${manifest.source.revision}/`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validateSpec(spec) {
  if (!spec || !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(spec.path)
      || !Number.isSafeInteger(spec.bytes) || spec.bytes < 1
      || !/^[a-f0-9]{64}$/.test(spec.sha256)) throw new Error("model manifest file is invalid");
}

async function verifiedExisting(target, spec) {
  try {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== spec.bytes) return false;
    return digest(await fsp.readFile(target)) === spec.sha256;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function download(url, target, spec) {
  if (await verifiedExisting(target, spec)) return;
  try {
    await fsp.lstat(target);
    throw new Error(`refusing to replace unverified model file: ${spec.path ?? path.basename(target)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new Error(`model download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== spec.bytes || digest(bytes) !== spec.sha256) {
    throw new Error(`model download verification failed: ${spec.path ?? path.basename(target)}`);
  }
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await fsp.link(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

if (manifest.schemaVersion !== "podcast-visualizer-model-source-v1"
    || manifest.model !== "speaker-diarization"
    || manifest.source.repository !== "FluidInference/speaker-diarization-coreml"
    || !/^[a-f0-9]{40}$/.test(manifest.source.revision)
    || manifest.license.spdx !== "CC-BY-4.0"
    || !manifest.license.url.startsWith("https://creativecommons.org/licenses/by/4.0/")) {
  throw new Error("diarization model source manifest is invalid");
}
manifest.files.forEach(validateSpec);
if (new Set(manifest.files.map(({ path: value }) => value)).size !== manifest.files.length) {
  throw new Error("diarization model source manifest contains duplicate paths");
}

await fsp.mkdir(destination, { recursive: true, mode: 0o755 });
for (const spec of manifest.files) {
  const encodedPath = spec.path.split("/").map(encodeURIComponent).join("/");
  await download(new URL(encodedPath, base), path.join(destination, spec.path), spec);
}
const licenseSpec = { path: "LICENSE.CC-BY-4.0", bytes: manifest.license.bytes, sha256: manifest.license.sha256 };
await download(new URL(manifest.license.url), path.join(destination, licenseSpec.path), licenseSpec);
const evidence = {
  ...manifest,
  installedAt: new Date().toISOString(),
  destination: `models/${manifest.model}`
};
await fsp.writeFile(path.join(destination, "source-manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
  mode: 0o644
}).catch(async (error) => {
  if (error?.code !== "EEXIST") throw error;
  const existing = JSON.parse(await fsp.readFile(path.join(destination, "source-manifest.json"), "utf8"));
  if (existing.source?.revision !== manifest.source.revision) throw error;
});
process.stdout.write(`${destination}\n`);
