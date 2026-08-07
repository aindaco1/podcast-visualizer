import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = JSON.parse(await fsp.readFile(
  path.join(ROOT, "resources", "runtime-manifests", "node-macos-arm64.json"), "utf8"
));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function dependencies(binary) {
  return run("/usr/bin/otool", ["-L", binary]).split("\n").slice(1)
    .map((line) => line.trim().split(" (")[0]).filter(Boolean);
}

if (sourceManifest.schemaVersion !== "podcast-visualizer-node-source-v1"
    || sourceManifest.platform !== "macos-arm64"
    || !/^24\.\d+\.\d+$/.test(sourceManifest.version)
    || !sourceManifest.source.url.startsWith("https://nodejs.org/dist/")
    || !/^[a-f0-9]{64}$/.test(sourceManifest.source.sha256)) {
  throw new Error("Node source manifest is invalid");
}

const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-node-"));
try {
  const archive = path.join(temporaryRoot, "node.tar.xz");
  const response = await fetch(sourceManifest.source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  if (!response.ok) throw new Error(`Node download failed (${response.status})`);
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  if (digest(archiveBytes) !== sourceManifest.source.sha256) throw new Error("Node archive checksum mismatch");
  await fsp.writeFile(archive, archiveBytes, { flag: "wx", mode: 0o600 });
  const entries = run("/usr/bin/tar", ["-tf", archive]).trim().split("\n");
  const prefix = `node-v${sourceManifest.version}-darwin-arm64/`;
  if (!entries.length || entries.some((entry) => !entry.startsWith(prefix)
      || entry.split("/").includes("..") || entry.startsWith("/"))) {
    throw new Error("Node archive contains an unsafe path");
  }
  run("/usr/bin/tar", ["-xJf", archive, "-C", temporaryRoot]);
  const extracted = path.join(temporaryRoot, prefix);
  const binary = path.join(extracted, "bin", "node");
  const license = path.join(extracted, "LICENSE");
  const binaryStat = await fsp.lstat(binary);
  const licenseStat = await fsp.lstat(license);
  if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || !licenseStat.isFile() || licenseStat.isSymbolicLink()) {
    throw new Error("Node archive payload is invalid");
  }
  const binaryDependencies = dependencies(binary);
  if (binaryDependencies.some((item) => !item.startsWith("/usr/lib/") && !item.startsWith("/System/Library/"))) {
    throw new Error("Node retained a non-system dynamic dependency");
  }
  const version = run(binary, ["--version"]).trim();
  if (version !== `v${sourceManifest.version}`) throw new Error("Node binary version mismatch");
  const build = run("/usr/bin/xcrun", ["vtool", "-show-build", binary]);
  const minimumMacOS = build.match(/^\s*minos\s+([0-9.]+)$/m)?.[1];
  if (!minimumMacOS) throw new Error("Node minimum macOS could not be determined");

  const destination = path.join(ROOT, "runtime", "macos-arm64");
  const target = path.join(destination, "bin", "node");
  const licenseTarget = path.join(destination, "LICENSE.Node");
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  for (const [source, output, mode] of [[binary, target, 0o755], [license, licenseTarget, 0o644]]) {
    const bytes = await fsp.readFile(source);
    const existing = await fsp.readFile(output).catch(() => null);
    if (existing && digest(existing) !== digest(bytes)) throw new Error(`refusing to replace ${path.basename(output)}`);
    if (!existing) {
      const temporary = `${output}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
      try {
        await fsp.writeFile(temporary, bytes, { flag: "wx", mode });
        await fsp.link(temporary, output);
      } finally {
        await fsp.unlink(temporary).catch(() => {});
      }
    }
    await fsp.chmod(output, mode);
  }
  const body = {
    schemaVersion: "podcast-visualizer-node-runtime-v1",
    platform: "macos-arm64",
    version: sourceManifest.version,
    minimumMacOS,
    license: sourceManifest.license,
    source: sourceManifest.source,
    files: [
      {
        path: "bin/node", bytes: (await fsp.stat(target)).size,
        sha256: digest(await fsp.readFile(target)), dependencies: dependencies(target)
      },
      {
        path: "LICENSE.Node", bytes: (await fsp.stat(licenseTarget)).size,
        sha256: digest(await fsp.readFile(licenseTarget)), dependencies: []
      }
    ]
  };
  const manifest = { ...body, manifestSha256: digest(Buffer.from(`${JSON.stringify(body)}\n`)) };
  const outputManifest = path.join(destination, "node-manifest.json");
  await fsp.writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(await fsp.readFile(outputManifest, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw error;
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}
