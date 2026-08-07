import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z0-9-]+$/.test(name) || !value) throw new Error("invalid staging arguments");
    result[name.slice(2)] = value;
  }
  return result;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function dependencies(binary) {
  return run("/usr/bin/otool", ["-L", binary]).split("\n").slice(1)
    .map((line) => line.trim().split(" (")[0]).filter(Boolean);
}

const input = parseOptions(process.argv.slice(2));
for (const required of ["binary", "record-revision", "swift-version"]) {
  if (!input[required]) throw new Error(`missing --${required}`);
}
if (!/^[a-f0-9]{40}$/.test(input["record-revision"])) throw new Error("Record revision is invalid");
const source = path.resolve(input.binary);
const sourceStat = await fsp.lstat(source);
if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || (sourceStat.mode & 0o111) === 0) {
  throw new Error("speech sidecar build output is invalid");
}
const architecture = run("/usr/bin/file", [source]);
if (!architecture.includes("Mach-O 64-bit executable arm64")) throw new Error("speech sidecar is not arm64-only");
const sourceDependencies = dependencies(source);
if (sourceDependencies.some((item) => !item.startsWith("/usr/lib/") && !item.startsWith("/System/Library/"))) {
  throw new Error("speech sidecar retained a non-system dynamic dependency");
}
const build = run("/usr/bin/xcrun", ["vtool", "-show-build", source]);
const minimumMacOS = build.match(/^\s*minos\s+([0-9.]+)$/m)?.[1];
if (!minimumMacOS) throw new Error("speech sidecar minimum macOS could not be determined");

const resolved = JSON.parse(await fsp.readFile(path.join(ROOT, "speech-sidecar", "Package.resolved"), "utf8"));
const fluidAudio = resolved.pins.find(({ identity }) => identity === "fluidaudio")?.state;
if (!fluidAudio?.revision || !fluidAudio?.version) throw new Error("FluidAudio pin is missing");

const destination = path.join(ROOT, "runtime", "macos-arm64");
const target = path.join(destination, "bin", "podcast-visualizer-speech");
const manifestPath = path.join(destination, "speech-manifest.json");
await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
const bytes = await fsp.readFile(source);
const existing = await fsp.readFile(target).catch(() => null);
const previousManifest = await fsp.readFile(manifestPath, "utf8").then(JSON.parse).catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});
if (existing) {
  if (!previousManifest) throw new Error("refusing to replace an unmanifested speech sidecar");
  const { manifestSha256, ...previousBody } = previousManifest;
  if (manifestSha256 !== digest(Buffer.from(`${JSON.stringify(previousBody)}\n`))
      || previousManifest.file?.sha256 !== digest(existing)) {
    throw new Error("refusing to replace an unverified speech sidecar");
  }
} else if (previousManifest) {
  throw new Error("speech runtime manifest exists without its binary");
}
if (!existing || digest(existing) !== digest(bytes)) {
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(temporary, 0o755);
    run("/usr/bin/codesign", ["--verify", "--strict", temporary]);
    await fsp.rename(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}
await fsp.chmod(target, 0o755);
run("/usr/bin/codesign", ["--verify", "--strict", target]);

const body = {
  schemaVersion: "podcast-visualizer-speech-runtime-v1",
  platform: "macos-arm64",
  minimumMacOS,
  recordRevision: input["record-revision"],
  fluidAudio: { version: fluidAudio.version, revision: fluidAudio.revision },
  swiftVersion: input["swift-version"],
  file: {
    path: "bin/podcast-visualizer-speech",
    bytes: (await fsp.stat(target)).size,
    sha256: digest(await fsp.readFile(target)),
    dependencies: dependencies(target)
  }
};
const manifest = { ...body, manifestSha256: digest(Buffer.from(`${JSON.stringify(body)}\n`)) };
if (!previousManifest || JSON.stringify(previousManifest) !== JSON.stringify(manifest)) {
  const temporary = `${manifestPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await fsp.rename(temporary, manifestPath);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
