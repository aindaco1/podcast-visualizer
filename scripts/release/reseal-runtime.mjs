#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { sha256 } from "../../src/canonical-json.js";
import { hashFile } from "../../src/files.js";
import { inspectPortableMachOFiles } from "../../src/macho-runtime.js";
import { pythonPackageInventory } from "../../src/python-packages.js";
import { runtimeTreeEvidence } from "../../src/runtime-tree.js";

const run = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/;
const SIGNING = Object.freeze({
  schemaVersion: "podcast-visualizer-runtime-signing-v1",
  mode: "developer-id"
});

function seal(body) {
  return { ...body, manifestSha256: sha256(`${JSON.stringify(body)}\n`) };
}

async function readManifest(filePath, schemaVersion, keys) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 2 * 1024 * 1024) {
    throw new Error(`runtime manifest is missing or unsafe: ${path.basename(filePath)}`);
  }
  const manifest = JSON.parse(await fsp.readFile(filePath, "utf8"));
  if (!manifest || manifest.schemaVersion !== schemaVersion || !HASH.test(manifest.manifestSha256 || "")
      || Object.keys(manifest).length !== keys.size || Object.keys(manifest).some((key) => !keys.has(key))) {
    throw new Error(`runtime manifest contract is invalid: ${path.basename(filePath)}`);
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) {
    throw new Error(`runtime manifest hash is invalid: ${path.basename(filePath)}`);
  }
  return manifest;
}

function safeTarget(root, relative, pattern) {
  if (!pattern.test(relative)) throw new Error(`runtime manifest path is invalid: ${relative}`);
  const target = path.resolve(root, relative);
  const containment = path.relative(root, target);
  if (!containment || containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
    throw new Error(`runtime manifest path escapes its root: ${relative}`);
  }
  return target;
}

async function dependencies(binary) {
  const result = await run("/usr/bin/otool", ["-L", binary], { maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.split("\n").slice(1).map((line) => line.trim().split(" (")[0]).filter(Boolean);
}

async function fileEvidence(root, file, pattern) {
  const target = safeTarget(root, file.path, pattern);
  const stat = await fsp.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`signed runtime file is unsafe: ${file.path}`);
  return {
    ...file,
    bytes: stat.size,
    sha256: await hashFile(target),
    dependencies: /\.(?:txt|Node)$/.test(file.path) ? [] : await dependencies(target)
  };
}

async function writeReplacement(filePath, manifest) {
  const temporary = `${filePath}.signed-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await fsp.rename(temporary, filePath);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

if (process.argv.length !== 3) {
  process.stderr.write("usage: reseal-runtime.mjs <runtime-root>\n");
  process.exitCode = 64;
} else {
  const root = path.resolve(process.argv[2]);
  const rootStat = await fsp.lstat(root).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("runtime root is unsafe");
  const paths = {
    ffmpeg: path.join(root, "manifest.json"),
    node: path.join(root, "node-manifest.json"),
    speech: path.join(root, "speech-manifest.json"),
    alignment: path.join(root, "alignment-manifest.json")
  };
  const [ffmpeg, node, speech, alignment] = await Promise.all([
    readManifest(paths.ffmpeg, "podcast-visualizer-ffmpeg-runtime-v1", new Set([
      "schemaVersion", "platform", "license", "source", "configureFlags", "files", "manifestSha256"
    ])),
    readManifest(paths.node, "podcast-visualizer-node-runtime-v2", new Set([
      "schemaVersion", "platform", "version", "minimumMacOS", "license", "source", "files",
      "parentManifestSha256", "optimization", "manifestSha256"
    ])),
    readManifest(paths.speech, "podcast-visualizer-speech-runtime-v1", new Set([
      "schemaVersion", "platform", "minimumMacOS", "recordRevision", "fluidAudio", "swiftVersion", "file",
      "manifestSha256"
    ])),
    readManifest(paths.alignment, "podcast-visualizer-alignment-runtime-v2", new Set([
      "schemaVersion", "platform", "minimumMacOS", "pythonVersion", "pythonProvider", "whisperxVersion",
      "runnerRevision", "sourceManifestSha256", "punktTab", "tree", "pythonLicense", "machoFilesInspected",
      "packages", "parentManifestSha256", "optimization", "manifestSha256"
    ]))
  ]);
  const ffmpegPattern = /^(?:bin\/(?:ffmpeg|ffprobe)|lib\/[A-Za-z0-9._+-]+\.dylib)$/;
  const ffmpegFiles = await Promise.all(ffmpeg.files.map((file) => fileEvidence(root, file, ffmpegPattern)));
  const nodeFiles = await Promise.all(node.files.map((file) =>
    fileEvidence(root, file, /^(?:bin\/node|LICENSE\.Node)$/)));
  const speechFile = await fileEvidence(root, speech.file, /^bin\/podcast-visualizer-speech$/);
  const alignmentRoot = path.join(root, "alignment");
  const packages = await pythonPackageInventory(path.join(alignmentRoot, "site-packages"));
  const replacements = {
    ffmpeg: seal({
      ...Object.fromEntries(Object.entries(ffmpeg).filter(([key]) => !["schemaVersion", "manifestSha256", "files"].includes(key))),
      schemaVersion: "podcast-visualizer-ffmpeg-runtime-v2",
      files: ffmpegFiles,
      signedFromManifestSha256: ffmpeg.manifestSha256,
      signing: SIGNING
    }),
    node: seal({
      ...Object.fromEntries(Object.entries(node).filter(([key]) => !["schemaVersion", "manifestSha256", "files"].includes(key))),
      schemaVersion: "podcast-visualizer-node-runtime-v3",
      files: nodeFiles,
      signedFromManifestSha256: node.manifestSha256,
      signing: SIGNING
    }),
    speech: seal({
      ...Object.fromEntries(Object.entries(speech).filter(([key]) => !["schemaVersion", "manifestSha256", "file"].includes(key))),
      schemaVersion: "podcast-visualizer-speech-runtime-v2",
      file: speechFile,
      signedFromManifestSha256: speech.manifestSha256,
      signing: SIGNING
    }),
    alignment: seal({
      ...Object.fromEntries(Object.entries(alignment).filter(([key]) =>
        !["schemaVersion", "manifestSha256", "tree", "machoFilesInspected", "packages"].includes(key))),
      schemaVersion: "podcast-visualizer-alignment-runtime-v3",
      tree: await runtimeTreeEvidence(alignmentRoot, { label: "signed alignment runtime" }),
      machoFilesInspected: await inspectPortableMachOFiles(alignmentRoot, { label: "signed alignment runtime" }),
      packages,
      signedFromManifestSha256: alignment.manifestSha256,
      signing: SIGNING
    })
  };
  await Promise.all(Object.entries(paths).map(([key, filePath]) => writeReplacement(filePath, replacements[key])));
  process.stdout.write(`${JSON.stringify(Object.fromEntries(
    Object.entries(replacements).map(([key, manifest]) => [key, manifest.manifestSha256])
  ), null, 2)}\n`);
}
