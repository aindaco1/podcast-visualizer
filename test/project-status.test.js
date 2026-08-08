import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { detectProjectStage } from "../src/project-status.js";

test("detects the latest resumable immutable project stage", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-project-status-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  assert.equal(await detectProjectStage(root), "initialized");
  await fsp.writeFile(path.join(root, "prepare.json"), "{}");
  assert.equal(await detectProjectStage(root), "prepared");
  await fsp.mkdir(path.join(root, "review"));
  await fsp.writeFile(path.join(root, "review", "draft.json"), "{}");
  assert.equal(await detectProjectStage(root), "review_required");
  await fsp.writeFile(path.join(root, "review", `transcript_${"a".repeat(24)}-approved.json`), "{}");
  assert.equal(await detectProjectStage(root), "approved");
  await fsp.mkdir(path.join(root, "alignment"));
  await fsp.writeFile(path.join(root, "alignment", `alignment_${"b".repeat(24)}-quality.json`), "{}");
  assert.equal(await detectProjectStage(root), "aligned");
  await fsp.mkdir(path.join(root, "renders"));
  await fsp.writeFile(path.join(root, "renders", `render_${"c".repeat(24)}.json`), "{}");
  assert.equal(await detectProjectStage(root), "verified");
});

test("rejects symlink project stage markers", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-project-status-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const outside = path.join(root, "outside.json");
  await fsp.writeFile(outside, "{}");
  await fsp.symlink(outside, path.join(root, "prepare.json"));
  await assert.rejects(detectProjectStage(root), /stage marker is unsafe/);
});
