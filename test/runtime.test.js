import assert from "node:assert/strict";
import test from "node:test";

import { defaultToolPath, smokeTestBundledRuntime, validateBundledRuntime } from "../src/runtime.js";

const MACOS_ARM64 = process.platform === "darwin" && process.arch === "arm64";

test("verifies the bundled, relocatable FFmpeg dependency closure", { skip: !MACOS_ARM64 }, async () => {
  const manifest = await validateBundledRuntime();
  assert.equal(manifest.platform, "macos-arm64");
  assert.ok(manifest.files.some(({ path }) => path === "lib/libass.9.dylib"));
  assert.ok(manifest.files.every(({ dependencies }) => dependencies.every((item) => !item.startsWith("/opt/homebrew/"))));
  assert.match(defaultToolPath("ffmpeg"), /runtime\/macos-arm64\/bin\/ffmpeg$/);
});

test("encodes libass text and decodes H.264/AAC with the bundled runtime", {
  skip: !MACOS_ARM64, timeout: 120_000
}, async () => {
  const result = await smokeTestBundledRuntime();
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
});
