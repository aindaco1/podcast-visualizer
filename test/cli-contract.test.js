import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRAND_RESOURCE, BRAND_SCHEMA, DUST_WAVE_BRAND, DUST_WAVE_SPEAKER_PALETTE
} from "../src/dust-wave-style.js";
import { ERROR_SCHEMA } from "../src/cli.js";
import { MEDIA_PROBE_SCHEMA } from "../src/prepare.js";
import { MAXIMUM_PROGRESS_EVENT_BYTES, PROGRESS_SCHEMA } from "../src/progress.js";
import { SPEAKER_PALETTE } from "../src/speaker-turns.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = path.join(ROOT, "bin", "dustwave-video.mjs");
const FIXTURES = path.join(ROOT, "test", "fixtures", "cli-contract", "v1");
const COMMANDS = [
  "probe", "init", "status", "prepare", "analyze", "review", "align", "render",
  "models status", "models import", "doctor"
];

function pcmWav(durationSeconds = 1, sampleRate = 16000) {
  const samples = durationSeconds * sampleRate;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function fixture(name) {
  return JSON.parse(await fsp.readFile(path.join(FIXTURES, name), "utf8"));
}

function progressEvents(result) {
  const output = result.output[3];
  return String(output ?? "").trim().split("\n").filter(Boolean).map((line) => {
    assert.ok(Buffer.byteLength(`${line}\n`) <= MAXIMUM_PROGRESS_EVENT_BYTES);
    return JSON.parse(line);
  });
}

test("freezes representative success and error JSON for every app command", async () => {
  const success = await fixture("success.json");
  const errors = await fixture("errors.json");
  assert.equal(success.schemaVersion, "podcast-visualizer-cli-success-fixtures-v1");
  assert.equal(errors.schemaVersion, "podcast-visualizer-cli-error-fixtures-v1");
  assert.deepEqual(success.fixtures.map(({ command }) => command), COMMANDS);
  assert.deepEqual(errors.fixtures.map(({ command }) => command), COMMANDS);
  assert.equal(success.fixtures[0].output.schemaVersion, MEDIA_PROBE_SCHEMA);
  for (const item of errors.fixtures) {
    assert.ok(Number.isSafeInteger(item.exitCode) && item.exitCode > 0);
    assert.match(item.error.code, /^[a-z]+(?:_[a-z]+)*$/);
    assert.ok(item.error.message.length > 0);
  }
});

test("emits bounded versioned progress separately from final JSON", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-cli-contract-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "input.wav");
  await fsp.writeFile(source, pcmWav());

  const result = spawnSync(process.execPath, [
    CLI, "probe", "--source", source, "--json", "--progress-fd", "3"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe", "pipe"] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const final = JSON.parse(result.stdout);
  assert.equal(final.schemaVersion, MEDIA_PROBE_SCHEMA);
  assert.equal(final.sourcePath, source);
  assert.equal(final.durationMs, 1000);
  assert.deepEqual(progressEvents(result), [
    { schemaVersion: PROGRESS_SCHEMA, sequence: 1, command: "probe", event: "command.started", detail: {} },
    { schemaVersion: PROGRESS_SCHEMA, sequence: 2, command: "probe", event: "command.completed", detail: {} }
  ]);
});

test("returns machine-readable errors and failure progress without stack traces", () => {
  const result = spawnSync(process.execPath, [
    CLI, "unknown", "--json", "--progress-fd", "3"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe", "pipe"] });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr);
  assert.equal(error.schemaVersion, ERROR_SCHEMA);
  assert.equal(error.command, "unknown");
  assert.equal(error.error.code, "usage");
  assert.doesNotMatch(result.stderr, / at .*src\//);
  assert.deepEqual(progressEvents(result).map(({ event }) => event), ["command.started", "command.failed"]);
});

test("freezes review launch progress and loads one neutral brand resource", async () => {
  const lines = (await fsp.readFile(path.join(FIXTURES, "progress.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map(({ sequence }) => sequence), [1, 2, 3]);
  assert.ok(lines.every(({ schemaVersion }) => schemaVersion === PROGRESS_SCHEMA));
  assert.equal(lines[1].detail.state, "review_required");
  assert.match(lines[1].detail.reviewUrl, /^http:\/\/127\.0\.0\.1:[0-9]+\/#token=/);

  const resource = JSON.parse(await fsp.readFile(BRAND_RESOURCE, "utf8"));
  assert.equal(resource.schemaVersion, BRAND_SCHEMA);
  assert.deepEqual(DUST_WAVE_BRAND, resource);
  assert.deepEqual(DUST_WAVE_SPEAKER_PALETTE, resource.speakers);
  assert.strictEqual(SPEAKER_PALETTE, DUST_WAVE_SPEAKER_PALETTE);
  const releaseBuilder = await fsp.readFile(path.join(ROOT, "scripts", "build-release.mjs"), "utf8");
  assert.match(releaseBuilder, /"resources\/brand"/);
});
