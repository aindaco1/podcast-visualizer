import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateExtractedRelease } from "../scripts/release-validation.mjs";

async function fixture(t) {
  const extraction = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-release-test-"));
  t.after(() => fsp.rm(extraction, { recursive: true, force: true }));
  const releaseName = "podcast-visualizer-test-macos-arm64";
  const releaseRoot = path.join(extraction, releaseName);
  await fsp.mkdir(path.join(releaseRoot, "bin"), { recursive: true });
  await fsp.writeFile(path.join(releaseRoot, "bin", "tool"), "binary");
  return { extraction, releaseName, releaseRoot };
}

test("accepts a single release root and contained relative symlinks", async (t) => {
  const value = await fixture(t);
  await fsp.symlink("bin/tool", path.join(value.releaseRoot, "tool"));
  const result = await validateExtractedRelease(value.extraction, value.releaseName);
  assert.equal(result.files, 1);
  assert.equal(result.symlinks, 1);
});

test("rejects extra top-level archive entries", async (t) => {
  const value = await fixture(t);
  await fsp.writeFile(path.join(value.extraction, "surprise"), "unsafe");
  await assert.rejects(validateExtractedRelease(value.extraction, value.releaseName), /exactly its named/);
});

test("rejects absolute, escaping, and dangling symlinks", async (t) => {
  const absolute = await fixture(t);
  await fsp.symlink("/tmp", path.join(absolute.releaseRoot, "escape"));
  await assert.rejects(validateExtractedRelease(absolute.extraction, absolute.releaseName), /escaping symlink/);

  const relative = await fixture(t);
  await fsp.symlink("../../outside", path.join(relative.releaseRoot, "escape"));
  await assert.rejects(validateExtractedRelease(relative.extraction, relative.releaseName), /escaping symlink/);

  const dangling = await fixture(t);
  await fsp.symlink("missing", path.join(dangling.releaseRoot, "dangling"));
  await assert.rejects(validateExtractedRelease(dangling.extraction, dangling.releaseName), /unsafe or dangling/);
});
