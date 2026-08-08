import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
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
const DEVELOPMENT_PACKAGES = new Set(["_pytest", "iniconfig", "pluggy", "pytest", "ruff"]);
const UNUSED_PACKAGE_ROOTS = new Set([
  "PIL", "alembic", "asteroid_filterbanks", "av", "colorlog", "contourpy", "ctranslate2", "cycler",
  "faster_whisper", "flatbuffers", "fontTools", "google", "grpc", "hf_xet", "julius", "kiwisolver",
  "lightning", "lightning_fabric", "lightning_utilities", "markdown_it", "matplotlib", "mdurl", "mpl_toolkits",
  "narwhals", "onnxruntime", "opentelemetry", "optuna", "primePy", "pyannote", "pyannoteai",
  "pygments", "pyparsing", "pytorch_lightning", "pytorch_metric_learning", "rich", "scipy", "sklearn",
  "sqlalchemy", "threadpoolctl.py", "torch_audiomentations", "torch_pitch_shift", "torchcodec", "torchmetrics",
  "torchvision"
]);
const UNUSED_DISTRIBUTIONS = new Set([
  "alembic", "asteroid-filterbanks", "av", "colorlog", "contourpy", "ctranslate2", "cycler",
  "faster-whisper", "flatbuffers", "fonttools", "googleapis-common-protos", "grpcio", "hf-xet", "julius",
  "kiwisolver", "lightning", "lightning-utilities", "markdown-it-py", "matplotlib", "mdurl", "narwhals",
  "onnxruntime", "opentelemetry-api", "opentelemetry-exporter-otlp",
  "opentelemetry-exporter-otlp-proto-common", "opentelemetry-exporter-otlp-proto-grpc",
  "opentelemetry-exporter-otlp-proto-http", "opentelemetry-proto", "opentelemetry-sdk",
  "opentelemetry-semantic-conventions", "optuna", "pillow", "primepy", "pyannote-audio", "pyannote-core",
  "pyannote-database", "pyannote-metrics", "pyannote-pipeline", "pyannoteai-sdk", "pygments", "pyparsing",
  "pytorch-lightning", "pytorch-metric-learning", "rich", "scikit-learn", "scipy", "sqlalchemy",
  "threadpoolctl", "torch-audiomentations", "torch-pitch-shift", "torchcodec", "torchmetrics", "torchvision"
]);
const ALIGNMENT_OPTIMIZATION = Object.freeze({
  schemaVersion: "podcast-visualizer-runtime-optimization-v1",
  removedClasses: Object.freeze([
    "development-packages", "non-english-tokenizers", "non-runtime-python-tooling", "package-tests",
    "python-bytecode", "unused-transformer-models", "unused-whisperx-dependencies", "unused-whisperx-features"
  ])
});
const NODE_OPTIMIZATION = Object.freeze({
  schemaVersion: "podcast-visualizer-runtime-optimization-v1",
  removedClasses: Object.freeze(["mach-o-symbol-table"])
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isDevelopmentDistInfo(name) {
  return /^(?:iniconfig|pluggy|pytest|ruff)-[^/]+\.dist-info$/.test(name);
}

function distributionName(name) {
  const match = /^(.+?)-(?=\d)[^/]*\.dist-info$/.exec(name);
  return match?.[1]?.toLowerCase().replace(/[_.]+/g, "-") || null;
}

export function includeOptimizedAlignmentPath(relativePath, isDirectory) {
  const normalized = relativePath.split(path.sep).join("/");
  const name = path.posix.basename(normalized);
  const segments = normalized.split("/");
  if (name === ".DS_Store" || name === "__pycache__" || name === ".pytest_cache") return false;
  if (!isDirectory && /\.(?:pyc|pyo)$/.test(name)) return false;
  if (normalized === "python/include" || normalized === "python/share"
      || normalized === "python/lib/pkgconfig" || normalized === "python/lib/python3.13/site-packages"
      || normalized === "python/lib/python3.13/ensurepip" || normalized === "python/lib/python3.13/idlelib"
      || normalized === "python/lib/python3.13/tkinter" || normalized === "python/lib/python3.13/turtledemo"
      || normalized === "python/lib/python3.13/venv" || normalized === "python/lib/python3.13/__phello__"
      || (/^python\/lib\/(?:itcl|libtcl|tcl|thread|tk)/.test(normalized) && segments.length === 3)) return false;
  if (segments[0] === "nltk_data" && segments[1] === "tokenizers" && segments[2] === "punkt_tab"
      && segments.length >= 4 && !["README", "english"].includes(segments[3])) return false;
  if (!normalized.startsWith("site-packages/")) return true;
  if (isDirectory && (segments.at(-1) === "test" || segments.at(-1) === "tests")) return false;
  if (segments.length === 2 && isDirectory
      && (DEVELOPMENT_PACKAGES.has(segments[1]) || isDevelopmentDistInfo(segments[1]))) return false;
  if (segments.length === 2 && (UNUSED_PACKAGE_ROOTS.has(segments[1])
      || UNUSED_DISTRIBUTIONS.has(distributionName(segments[1])))) return false;
  if (normalized === "site-packages/torch/include"
      || normalized === "site-packages/whisperx/assets/pytorch_model.bin") return false;
  if (segments[1] === "transformers" && segments[2] === "models" && segments.length >= 4
      && !["__init__.py", "auto", "wav2vec2"].includes(segments[3])) return false;
  return true;
}

async function readManifest(filePath, maximumBytes) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`runtime manifest is missing or unsafe: ${path.basename(filePath)}`);
  }
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function verifyManifestHash(manifest, schemaVersion) {
  if (manifest?.schemaVersion !== schemaVersion || !HASH.test(manifest.manifestSha256 || "")) {
    throw new Error(`runtime manifest contract is invalid: ${schemaVersion}`);
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) {
    throw new Error(`runtime manifest hash is invalid: ${schemaVersion}`);
  }
}

function hasOnlyKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.has(key)) && Object.keys(value).length === keys.size;
}

function verifyNodeManifest(manifest) {
  const keys = new Set([
    "schemaVersion", "platform", "version", "minimumMacOS", "license", "source", "files", "manifestSha256"
  ]);
  verifyManifestHash(manifest, "podcast-visualizer-node-runtime-v1");
  const paths = new Set((manifest.files || []).map(({ path: item }) => item));
  if (!hasOnlyKeys(manifest, keys) || manifest.platform !== "macos-arm64"
      || !/^24\.\d+\.\d+$/.test(manifest.version || "") || manifest.files?.length !== 2
      || paths.size !== 2 || !paths.has("bin/node") || !paths.has("LICENSE.Node")) {
    throw new Error("Node runtime source manifest contract is invalid");
  }
}

function verifyAlignmentManifest(manifest) {
  const keys = new Set([
    "schemaVersion", "platform", "minimumMacOS", "pythonVersion", "pythonProvider",
    "whisperxVersion", "runnerRevision", "sourceManifestSha256", "punktTab", "tree",
    "pythonLicense", "machoFilesInspected", "packages", "manifestSha256"
  ]);
  verifyManifestHash(manifest, "podcast-visualizer-alignment-runtime-v1");
  if (!hasOnlyKeys(manifest, keys) || manifest.platform !== "macos-arm64"
      || manifest.pythonVersion !== "3.13.13" || manifest.whisperxVersion !== "3.8.6"
      || !HASH.test(manifest.tree?.sha256 || "") || !Number.isSafeInteger(manifest.tree?.bytes)
      || !Array.isArray(manifest.packages)) {
    throw new Error("alignment runtime source manifest contract is invalid");
  }
}

async function assertRealDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stat = await fsp.lstat(resolved).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} is not a real directory`);
  return fsp.realpath(resolved);
}

async function copyRealFile(source, destination, mode) {
  const stat = await fsp.lstat(source).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`runtime file is missing or unsafe: ${source}`);
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(destination, mode);
}

async function dependencies(binary) {
  const result = await run("/usr/bin/otool", ["-L", binary], { maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.split("\n").slice(1)
    .map((line) => line.trim().split(" (")[0]).filter(Boolean);
}

async function copyAlignment(source, destination) {
  await fsp.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter: async (candidate) => {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const stat = await fsp.lstat(candidate);
      return includeOptimizedAlignmentPath(relative, stat.isDirectory());
    }
  });
}

export async function optimizeReleaseRuntime(sourceRoot, destinationRoot) {
  const source = await assertRealDirectory(sourceRoot, "release runtime source");
  const requestedDestination = path.resolve(destinationRoot);
  const destinationParent = await assertRealDirectory(
    path.dirname(requestedDestination), "release runtime destination parent"
  );
  const destination = path.join(destinationParent, path.basename(requestedDestination));
  if (destination === source || destination === destinationParent || destination === path.parse(destination).root
      || path.relative(source, destination) === "" || !path.relative(source, destination).startsWith("..")) {
    throw new Error("release runtime destination must be a new sibling tree");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(path.basename(destination))) {
    throw new Error("release runtime destination name is unsafe");
  }
  if (await fsp.lstat(destination).catch(() => null)) throw new Error("refusing to replace an optimized runtime");

  const nodeManifest = await readManifest(path.join(source, "node-manifest.json"), 256 * 1024);
  const alignmentManifest = await readManifest(path.join(source, "alignment-manifest.json"), 2 * 1024 * 1024);
  verifyNodeManifest(nodeManifest);
  verifyAlignmentManifest(alignmentManifest);
  const sourceAlignmentEvidence = await runtimeTreeEvidence(
    path.join(source, "alignment"), { label: "alignment runtime source" }
  );
  if (JSON.stringify(alignmentManifest.tree) !== JSON.stringify(sourceAlignmentEvidence)) {
    throw new Error("alignment runtime source does not match its manifest");
  }
  for (const file of nodeManifest.files || []) {
    const target = path.join(source, file.path);
    const stat = await fsp.lstat(target).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.bytes
        || await hashFile(target) !== file.sha256) throw new Error(`Node runtime source mismatch: ${file.path}`);
  }
  await runtimeTreeEvidence(path.join(source, "models"), { label: "model runtime source" });

  const parentNodeHash = nodeManifest.manifestSha256;
  const parentAlignmentHash = alignmentManifest.manifestSha256;
  try {
    await fsp.mkdir(destination, { recursive: false, mode: 0o700 });
    const nodeTarget = path.join(destination, "bin", "node");
    await copyRealFile(path.join(source, "bin", "node"), nodeTarget, 0o755);
    await run("/usr/bin/strip", ["-S", "-x", nodeTarget], { maxBuffer: 2 * 1024 * 1024 });
    await run("/usr/bin/codesign", [
      "--force", "--timestamp=none", "--sign", "-", nodeTarget
    ], { maxBuffer: 2 * 1024 * 1024 });
    await copyRealFile(path.join(source, "LICENSE.Node"), path.join(destination, "LICENSE.Node"), 0o644);
    await copyAlignment(path.join(source, "alignment"), path.join(destination, "alignment"));
    await fsp.cp(path.join(source, "models"), path.join(destination, "models"), {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true
    });

    const packages = await pythonPackageInventory(path.join(destination, "alignment", "site-packages"));
    const alignmentBody = {
      ...Object.fromEntries(Object.entries(alignmentManifest).filter(([key]) =>
        !["schemaVersion", "manifestSha256", "tree", "packages"].includes(key))),
      schemaVersion: "podcast-visualizer-alignment-runtime-v2",
      parentManifestSha256: parentAlignmentHash,
      optimization: ALIGNMENT_OPTIMIZATION,
      tree: await runtimeTreeEvidence(path.join(destination, "alignment"), { label: "optimized alignment runtime" }),
      machoFilesInspected: await inspectPortableMachOFiles(path.join(destination, "alignment"), {
        label: "optimized alignment runtime"
      }),
      packages
    };
    const optimizedAlignmentManifest = {
      ...alignmentBody,
      manifestSha256: digest(Buffer.from(`${JSON.stringify(alignmentBody)}\n`))
    };

    const licenseTarget = path.join(destination, "LICENSE.Node");
    const nodeBody = {
      ...Object.fromEntries(Object.entries(nodeManifest).filter(([key]) =>
        !["schemaVersion", "manifestSha256", "files"].includes(key))),
      schemaVersion: "podcast-visualizer-node-runtime-v2",
      parentManifestSha256: parentNodeHash,
      optimization: NODE_OPTIMIZATION,
      files: [
        {
          path: "bin/node", bytes: (await fsp.stat(nodeTarget)).size,
          sha256: await hashFile(nodeTarget), dependencies: await dependencies(nodeTarget)
        },
        {
          path: "LICENSE.Node", bytes: (await fsp.stat(licenseTarget)).size,
          sha256: await hashFile(licenseTarget), dependencies: []
        }
      ]
    };
    const optimizedNodeManifest = {
      ...nodeBody,
      manifestSha256: digest(Buffer.from(`${JSON.stringify(nodeBody)}\n`))
    };
    await fsp.writeFile(path.join(destination, "alignment-manifest.json"),
      `${JSON.stringify(optimizedAlignmentManifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await fsp.writeFile(path.join(destination, "node-manifest.json"),
      `${JSON.stringify(optimizedNodeManifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });

    return {
      sourceAlignmentBytes: alignmentManifest.tree.bytes,
      optimizedAlignmentBytes: optimizedAlignmentManifest.tree.bytes,
      sourceNodeBytes: nodeManifest.files.find(({ path: item }) => item === "bin/node")?.bytes,
      optimizedNodeBytes: optimizedNodeManifest.files[0].bytes,
      removedPackages: alignmentManifest.packages
        .filter(({ name }) => !packages.some((item) => item.name === name)).map(({ name }) => name).sort()
    };
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}
