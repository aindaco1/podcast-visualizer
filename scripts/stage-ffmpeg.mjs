import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function options(argv) {
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
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, shell: false });
  if (result.status !== 0) throw new Error(`${command} validation failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function dependencies(binary) {
  return run("/usr/bin/otool", ["-L", binary]).split("\n").slice(1)
    .map((line) => line.trim().split(" (")[0]).filter(Boolean);
}

function isSystemDependency(value) {
  return value.startsWith("/usr/lib/") || value.startsWith("/System/Library/");
}

async function resolveDependency(value, owner) {
  if (isSystemDependency(value)) return null;
  let candidates = [];
  if (value.startsWith("/")) candidates = [value];
  else if (value.startsWith("@loader_path/")) {
    candidates = [path.join(path.dirname(owner), value.slice("@loader_path/".length))];
  } else if (value.startsWith("@rpath/")) {
    const name = path.basename(value);
    candidates = [path.join(path.dirname(owner), name), path.join("/opt/homebrew/lib", name)];
  } else {
    throw new Error(`unsupported dynamic dependency reference in ${owner}: ${value}`);
  }
  for (const candidate of candidates) {
    try {
      const resolved = await fsp.realpath(candidate);
      const stat = await fsp.lstat(resolved);
      if (stat.isFile() && !stat.isSymbolicLink()) return resolved;
    } catch {
      // Try the next bounded location.
    }
  }
  throw new Error(`could not resolve dynamic dependency in ${owner}: ${value}`);
}

async function collectClosure(binaries) {
  const closure = new Map();
  const queue = [...binaries];
  const visited = new Set();
  while (queue.length) {
    const owner = queue.shift();
    const ownerRealPath = await fsp.realpath(owner);
    if (visited.has(ownerRealPath)) continue;
    visited.add(ownerRealPath);
    for (const reference of dependencies(ownerRealPath)) {
      const resolved = await resolveDependency(reference, ownerRealPath);
      if (!resolved) continue;
      const name = path.basename(reference);
      const existing = closure.get(name);
      if (existing && existing !== resolved
          && digest(await fsp.readFile(existing)) !== digest(await fsp.readFile(resolved))) {
        throw new Error(`dynamic dependency basename collision: ${name}`);
      }
      if (!existing) {
        closure.set(name, resolved);
        queue.push(resolved);
      }
    }
  }
  return closure;
}

function rewriteDependencies(target) {
  for (const reference of dependencies(target)) {
    if (isSystemDependency(reference) || reference.startsWith("@rpath/")) continue;
    run("/usr/bin/install_name_tool", ["-change", reference, `@rpath/${path.basename(reference)}`, target]);
  }
}

const input = options(process.argv.slice(2));
for (const required of ["ffmpeg", "ffprobe", "license", "source-sha256", "source-url", "configure-flags"]) {
  if (!input[required]) throw new Error(`missing --${required}`);
}
if (!/^[a-f0-9]{64}$/.test(input["source-sha256"]) || !input["source-url"].startsWith("https://ffmpeg.org/")) {
  throw new Error("FFmpeg source provenance is invalid");
}
const destination = path.join(ROOT, "runtime", "macos-arm64");
const binDirectory = path.join(destination, "bin");
const libDirectory = path.join(destination, "lib");
await fsp.mkdir(binDirectory, { recursive: true, mode: 0o755 });
await fsp.mkdir(libDirectory, { recursive: true, mode: 0o755 });
const closure = await collectClosure([path.resolve(input.ffmpeg), path.resolve(input.ffprobe)]);
const files = [];
for (const tool of ["ffmpeg", "ffprobe"]) {
  const source = path.resolve(input[tool]);
  const sourceStat = await fsp.lstat(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error(`${tool} build output is invalid`);
  const target = path.join(binDirectory, tool);
  const bytes = await fsp.readFile(source);
  const existing = await fsp.readFile(target).catch(() => null);
  if (existing && digest(existing) !== digest(bytes)) throw new Error(`refusing to replace existing ${tool} sidecar`);
  if (!existing) await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(target, 0o755);
  rewriteDependencies(target);
  run("/usr/bin/install_name_tool", ["-add_rpath", "@executable_path/../lib", target]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", target]);
  files.push({
    path: `bin/${tool}`,
    bytes: bytes.length,
    sha256: digest(bytes),
    version: run(source, ["-version"]).split("\n")[0].trim(),
    dependencies: dependencies(target)
  });
}
for (const [name, source] of [...closure].sort(([left], [right]) => left.localeCompare(right))) {
  const target = path.join(libDirectory, name);
  const bytes = await fsp.readFile(source);
  const existing = await fsp.readFile(target).catch(() => null);
  if (existing && digest(existing) !== digest(bytes)) throw new Error(`refusing to replace existing runtime library ${name}`);
  if (!existing) await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(target, 0o755);
  rewriteDependencies(target);
  run("/usr/bin/install_name_tool", ["-id", `@rpath/${name}`, target]);
  run("/usr/bin/install_name_tool", ["-add_rpath", "@loader_path", target]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", target]);
  const stagedDependencies = dependencies(target);
  const invalid = stagedDependencies.filter((item) => !isSystemDependency(item) && !item.startsWith("@rpath/"));
  if (invalid.length) throw new Error(`${name} retained non-relocatable dependencies: ${invalid.join(", ")}`);
  files.push({
    path: `lib/${name}`,
    bytes: (await fsp.stat(target)).size,
    sha256: digest(await fsp.readFile(target)),
    version: null,
    dependencies: stagedDependencies
  });
}
for (const tool of ["ffmpeg", "ffprobe"]) {
  const target = path.join(binDirectory, tool);
  files.find((entry) => entry.path === `bin/${tool}`).sha256 = digest(await fsp.readFile(target));
  files.find((entry) => entry.path === `bin/${tool}`).bytes = (await fsp.stat(target)).size;
  run("/usr/bin/codesign", ["--verify", "--strict", target]);
  run(target, ["-version"]);
}
const licenseBytes = await fsp.readFile(input.license);
await fsp.writeFile(path.join(destination, "COPYING.LGPLv2.1"), licenseBytes, { flag: "wx", mode: 0o644 }).catch(async (error) => {
  if (error.code !== "EEXIST" || digest(await fsp.readFile(path.join(destination, "COPYING.LGPLv2.1"))) !== digest(licenseBytes)) throw error;
});
const body = {
  schemaVersion: "podcast-visualizer-ffmpeg-runtime-v1",
  platform: "macos-arm64",
  license: "LGPL-2.1-or-later",
  source: { url: input["source-url"], sha256: input["source-sha256"] },
  configureFlags: input["configure-flags"].split(" "),
  files: files.sort((left, right) => left.path.localeCompare(right.path))
};
const manifest = { ...body, manifestSha256: digest(Buffer.from(`${JSON.stringify(body)}\n`)) };
await fsp.writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 }).catch(async (error) => {
  if (error.code !== "EEXIST") throw error;
  const existing = JSON.parse(await fsp.readFile(path.join(destination, "manifest.json"), "utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw error;
});
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
