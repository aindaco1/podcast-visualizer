import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fsp.readFile(
  path.join(ROOT, "resources", "model-manifests", "whisperx-en.json"), "utf8"
));
const destination = path.join(ROOT, "models", "alignment", "whisperx-en");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
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

if (manifest.schemaVersion !== "podcast-visualizer-external-model-v1"
    || manifest.model !== "WAV2VEC2_ASR_BASE_960H"
    || manifest.modelVersion !== manifest.files?.[0]?.sha256
    || manifest.license !== "MIT"
    || manifest.files.length !== 1
    || !manifest.source.url.startsWith("https://download.pytorch.org/torchaudio/models/")) {
  throw new Error("alignment model manifest is invalid");
}
const spec = manifest.files[0];
const target = path.join(destination, spec.path);
const existing = await fsp.lstat(target).catch(() => null);
if (existing && (existing.isSymbolicLink() || !existing.isFile()
    || existing.size !== spec.bytes || await hashFile(target) !== spec.sha256)) {
  throw new Error("refusing to replace an unverified alignment model");
}
if (!existing) {
  const response = await fetch(manifest.source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(30 * 60 * 1000)
  });
  if (!response.ok) throw new Error(`alignment model download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== spec.bytes || digest(bytes) !== spec.sha256) {
    throw new Error("alignment model download checksum mismatch");
  }
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await fsp.link(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}
const evidence = { ...manifest, installedAt: new Date().toISOString() };
await fsp.writeFile(path.join(destination, "model-manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx", mode: 0o600
}).catch(async (error) => {
  if (error?.code !== "EEXIST") throw error;
  const current = JSON.parse(await fsp.readFile(path.join(destination, "model-manifest.json"), "utf8"));
  if (current.modelVersion !== manifest.modelVersion) throw error;
});
process.stdout.write(`${destination}\n`);
