import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultToolPath, smokeTestBundledRuntime, validateBundledNodeRuntime,
  isIgnorableRuntimeMetadata, validateAlignmentRuntimeAt, validateBundledAlignmentRuntime,
  validateBundledRuntime, validateNodeRuntimeAt,
  validateBundledSpeechRuntime
} from "../src/runtime.js";

const MACOS_ARM64 = process.platform === "darwin" && process.arch === "arm64";

test("ignores only inert Finder metadata in sealed runtime trees", () => {
  assert.equal(isIgnorableRuntimeMetadata(".DS_Store"), true);
  assert.equal(isIgnorableRuntimeMetadata("nested/.DS_Store"), false);
  assert.equal(isIgnorableRuntimeMetadata(".DS_Store.payload"), false);
});

test("verifies an explicit optimized alignment-only release runtime", {
  skip: !MACOS_ARM64 || !process.env.PODCAST_VISUALIZER_OPTIMIZED_RUNTIME,
  timeout: 120_000
}, async () => {
  const root = process.env.PODCAST_VISUALIZER_OPTIMIZED_RUNTIME;
  const [node, alignment] = await Promise.all([
    validateNodeRuntimeAt(root),
    validateAlignmentRuntimeAt(root)
  ]);
  assert.equal(node.schemaVersion, "podcast-visualizer-node-runtime-v2");
  assert.equal(alignment.schemaVersion, "podcast-visualizer-alignment-runtime-v2");
  assert.ok(alignment.tree.bytes < 500_000_000);
  assert.ok(alignment.packages.some(({ name }) => name.toLowerCase() === "whisperx"));
  assert.ok(!alignment.packages.some(({ name }) => name.toLowerCase() === "pyannote-audio"));
});

test("verifies the bundled, relocatable FFmpeg dependency closure", { skip: !MACOS_ARM64 }, async () => {
  const manifest = await validateBundledRuntime();
  assert.equal(manifest.platform, "macos-arm64");
  assert.ok(manifest.files.some(({ path }) => path === "lib/libass.9.dylib"));
  assert.ok(manifest.files.every(({ dependencies }) => dependencies.every((item) => !item.startsWith("/opt/homebrew/"))));
  assert.match(defaultToolPath("ffmpeg"), /runtime\/macos-arm64\/bin\/ffmpeg$/);
});

test("verifies the bundled Node LTS runtime", { skip: !MACOS_ARM64 }, async () => {
  const manifest = await validateBundledNodeRuntime();
  assert.equal(manifest.version, "24.19.0");
  assert.ok(manifest.files.some(({ path }) => path === "LICENSE.Node"));
});

test("verifies the arm64 speech sidecar and its system-only dependency closure", { skip: !MACOS_ARM64 }, async () => {
  const manifest = await validateBundledSpeechRuntime();
  assert.equal(manifest.minimumMacOS, "15.0");
  assert.equal(manifest.fluidAudio.version, "0.15.5");
  assert.ok(manifest.file.dependencies.every((item) => item.startsWith("/usr/lib/") || item.startsWith("/System/Library/")));
  assert.match(defaultToolPath("speech"), /runtime\/macos-arm64\/bin\/podcast-visualizer-speech$/);
});

test("verifies the bundled Python and locked WhisperX alignment environment", {
  skip: !MACOS_ARM64, timeout: 120_000
}, async () => {
  const manifest = await validateBundledAlignmentRuntime();
  assert.equal(manifest.pythonVersion, "3.13.13");
  assert.equal(manifest.whisperxVersion, "3.8.6");
  assert.ok(manifest.machoFilesInspected > 10);
  assert.ok(manifest.packages.some(({ name, version }) => name.toLowerCase() === "torch" && version === "2.8.0"));
});

test("encodes opaque, compact HEVC alpha, and ProRes 4444 alpha media with the bundled runtime", {
  skip: !MACOS_ARM64, timeout: 120_000
}, async () => {
  const result = await smokeTestBundledRuntime();
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.hevcAlpha, true);
  assert.equal(result.proresAlpha, true);
});
