import { createHash, randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVISION = "c28e08582e7bd36751febb3391142a5eb18bbb34";
const ASSETS = Object.freeze([
  {
    path: "resources/fonts/Inter.ttf",
    source: `ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf`,
    sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
    maximumBytes: 2 * 1024 * 1024
  },
  {
    path: "resources/fonts/IBMPlexMono-Regular.ttf",
    source: "ofl/ibmplexmono/IBMPlexMono-Regular.ttf",
    sha256: "6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46",
    maximumBytes: 512 * 1024
  },
  {
    path: "licenses/fonts/OFL-Inter.txt",
    source: "ofl/inter/OFL.txt",
    sha256: "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
    maximumBytes: 32 * 1024
  },
  {
    path: "licenses/fonts/OFL-IBM-Plex-Mono.txt",
    source: "ofl/ibmplexmono/OFL.txt",
    sha256: "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da",
    maximumBytes: 32 * 1024
  }
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function install(asset) {
  const destination = path.join(ROOT, asset.path);
  const existing = await fsp.readFile(destination).catch(() => null);
  if (existing) {
    if (digest(existing) !== asset.sha256) throw new Error(`${asset.path} has an unexpected hash`);
    return { path: asset.path, reused: true, bytes: existing.length, sha256: asset.sha256 };
  }
  const url = `https://raw.githubusercontent.com/google/fonts/${REVISION}/${asset.source}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok || response.url !== url) throw new Error(`download failed for ${asset.path}: ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && (declared < 1 || declared > asset.maximumBytes)) {
    throw new Error(`${asset.path} exceeds its declared size bound`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > asset.maximumBytes || digest(bytes) !== asset.sha256) {
    throw new Error(`${asset.path} failed size or SHA-256 verification`);
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  const temporary = `${destination}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await fsp.link(temporary, destination);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
  return { path: asset.path, reused: false, bytes: bytes.length, sha256: asset.sha256 };
}

const installed = [];
for (const asset of ASSETS) installed.push(await install(asset));
process.stdout.write(`${JSON.stringify({ revision: REVISION, installed }, null, 2)}\n`);
