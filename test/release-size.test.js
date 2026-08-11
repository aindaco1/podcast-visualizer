import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const script = path.join(ROOT, "scripts/release/validate-size-budget.mjs");

async function sizeFixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-size-budget-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, "Podcast Visualizer.app"));
  await fsp.writeFile(path.join(root, "Podcast Visualizer.app", "payload"), "app\n");
  for (const name of [
    "Podcast-Visualizer-1.1.0-arm64.zip",
    "Podcast-Visualizer-1.1.0-arm64.dmg",
    "Podcast.Visualizer4-3.delta"
  ]) await fsp.writeFile(path.join(root, name), `${name}\n`);
  return root;
}

test("records release artifact sizes without private absolute paths", async (context) => {
  const root = await sizeFixture(context);
  await run(process.execPath, [script], {
    env: {
      ...process.env,
      PODCAST_VISUALIZER_RELEASE_ROOT: root,
      PODCAST_VISUALIZER_VERSION: "1.1.0"
    }
  });
  const evidence = JSON.parse(await fsp.readFile(path.join(root, "ARTIFACT-SIZES.json"), "utf8"));
  assert.equal(evidence.schemaVersion, "podcast-visualizer-artifact-sizes-v1");
  assert.equal(evidence.artifacts.delta.name, "Podcast.Visualizer4-3.delta");
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("fails closed on a full-update size regression", async (context) => {
  const root = await sizeFixture(context);
  await fsp.truncate(path.join(root, "Podcast-Visualizer-1.1.0-arm64.zip"), 355_000_001);
  await assert.rejects(run(process.execPath, [script], {
    env: {
      ...process.env,
      PODCAST_VISUALIZER_RELEASE_ROOT: root,
      PODCAST_VISUALIZER_VERSION: "1.1.0"
    }
  }), /size budget exceeded for zipBytes/);
  await assert.rejects(fsp.lstat(path.join(root, "ARTIFACT-SIZES.json")));
});
