#!/usr/bin/env node
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { validateAlignmentRuntimeAt, validateNodeRuntimeAt } from "../../src/runtime.js";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REQUIRED_PACKAGES = new Map([
  ["nltk", "3.10.0"],
  ["numpy", "2.5.1"],
  ["pandas", "3.0.5"],
  ["torch", "2.8.0"],
  ["torchaudio", "2.8.0"],
  ["transformers", "4.57.6"],
  ["whisperx", "3.8.6"]
]);
const FORBIDDEN_PACKAGES = new Set([
  "faster-whisper", "onnxruntime", "pyannote-audio", "pytest", "ruff", "scipy", "torchcodec", "torchvision"
]);

if (process.argv.length !== 3) {
  process.stderr.write("usage: validate-alignment-only-runtime.mjs <runtime-root>\n");
  process.exitCode = 64;
} else {
  const runtimeRoot = path.resolve(process.argv[2]);
  const [node, alignment] = await Promise.all([
    validateNodeRuntimeAt(runtimeRoot),
    validateAlignmentRuntimeAt(runtimeRoot)
  ]);
  if (node.schemaVersion !== "podcast-visualizer-node-runtime-v2"
      || alignment.schemaVersion !== "podcast-visualizer-alignment-runtime-v2") {
    throw new Error("release runtime was not optimized from its pinned source");
  }
  const inventory = new Map(alignment.packages.map(({ name, version }) => [name.toLowerCase(), version]));
  for (const [name, version] of REQUIRED_PACKAGES) {
    if (inventory.get(name) !== version) throw new Error(`alignment-only runtime is missing ${name} ${version}`);
  }
  for (const name of FORBIDDEN_PACKAGES) {
    if (inventory.has(name)) throw new Error(`alignment-only runtime retained unused package ${name}`);
  }
  const absentPaths = [
    "alignment/nltk_data/tokenizers/punkt_tab/spanish",
    "alignment/python/include",
    "alignment/site-packages/torch/include",
    "alignment/site-packages/transformers/models/bert",
    "alignment/site-packages/whisperx/assets/pytorch_model.bin"
  ];
  for (const relative of absentPaths) {
    if (await fsp.lstat(path.join(runtimeRoot, relative)).catch(() => null)) {
      throw new Error(`alignment-only runtime retained ${relative}`);
    }
  }

  const pythonCode = [
    "import json",
    "import socket",
    "import torch, torchaudio, transformers, pandas, nltk, whisperx",
    "from nltk.data import load as nltk_load",
    "import dustwave_alignment_runner.cli",
    "import whisperx.alignment",
    "nltk_load('tokenizers/punkt_tab/english.pickle')",
    "assert socket.socket.__module__ == 'sitecustomize'",
    "print(json.dumps({'torch': torch.__version__, 'offlineSocket': True}))"
  ].join("\n");
  const result = await run(alignment.python, ["-s", "-c", pythonCode], {
    cwd: ROOT,
    env: {
      DUSTWAVE_ALIGNMENT_OFFLINE: "1",
      HF_DATASETS_OFFLINE: "1",
      HF_HUB_OFFLINE: "1",
      NLTK_DATA: alignment.nltkData,
      PATH: `${path.join(runtimeRoot, "bin")}:/usr/bin:/bin`,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONPATH: `${path.join(ROOT, "alignment-runner", "src")}${path.delimiter}${alignment.sitePackages}`,
      TRANSFORMERS_OFFLINE: "1"
    },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 2 * 60 * 1000
  });
  const smoke = JSON.parse(result.stdout);
  if (smoke.torch !== "2.8.0" || smoke.offlineSocket !== true) {
    throw new Error("alignment-only import smoke returned unexpected evidence");
  }
  process.stdout.write(`${JSON.stringify({
    alignmentBytes: alignment.tree.bytes,
    alignmentFiles: alignment.tree.files,
    nodeBytes: node.files.find(({ path: item }) => item === "bin/node").bytes,
    packages: alignment.packages.length,
    smoke
  }, null, 2)}\n`);
}
