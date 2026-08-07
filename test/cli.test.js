import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/dustwave-video.mjs", import.meta.url));

test("help documents the action-oriented surface", () => {
  const result = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dustwave-video init/);
  assert.match(result.stdout, /review required/);
});

test("unknown commands and options return usage errors", () => {
  const command = spawnSync(process.execPath, [CLI, "unknown"], { encoding: "utf8" });
  assert.equal(command.status, 2);
  assert.doesNotMatch(command.stderr, /at .*src\//);

  const option = spawnSync(process.execPath, [CLI, "doctor", "--unsafe"], { encoding: "utf8" });
  assert.equal(option.status, 2);
});
