import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeProject } from "../src/project.js";
import {
  ensureBrowserReviewAudio, loadPreparedMedia, prepareProject, validatePrepareManifest
} from "../src/prepare.js";

function pcmWav(durationSeconds = 2, sampleRate = 16000) {
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
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 12) * 1000), 44 + index * 2);
  }
  return buffer;
}

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-prepare-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "input.wav");
  const project = path.join(root, "project");
  await fsp.writeFile(source, pcmWav());
  const initialized = await initializeProject({ source, project, clip: "00:00.250-00:01.250" });
  return { root, project, initialized };
}

test("prepares immutable model and review audio with verified formats", async (context) => {
  const item = await fixture(context);
  const result = await prepareProject(item.project);
  assert.equal(result.prepare.analysis.sampleRate, 16000);
  assert.equal(result.prepare.analysis.channels, 1);
  assert.equal(result.prepare.review.sampleRate, 16000);
  assert.equal(result.prepare.review.channels, 1);
  assert.equal(result.prepare.review.relativePath, "source/review.wav");
  assert.equal((await ensureBrowserReviewAudio(result)).contentType, "audio/wav");
  assert.ok(Math.abs(result.prepare.analysis.durationMs - 1000) <= 150);
  assert.equal(validatePrepareManifest(result.prepare, item.initialized.manifest), result.prepare);
  const reused = await prepareProject(item.project);
  assert.equal(reused.prepare.manifestSha256, result.prepare.manifestSha256);
});

test("derives and verifies a PCM browser proxy for legacy AAC projects", async (context) => {
  const item = await fixture(context);
  const result = await prepareProject(item.project);
  const legacyPath = path.join(item.project, "source", "review.m4a");
  await fsp.copyFile(result.reviewPath, legacyPath);
  const legacy = {
    ...result,
    reviewPath: legacyPath,
    prepare: {
      ...result.prepare,
      review: { ...result.prepare.review, relativePath: "source/review.m4a" }
    }
  };
  const first = await ensureBrowserReviewAudio(legacy);
  assert.equal(first.contentType, "audio/wav");
  assert.equal(first.manifest.audio.codec, "pcm_s16le");
  assert.match(first.audioPath, /review-browser\.wav$/);
  const second = await ensureBrowserReviewAudio(legacy);
  assert.equal(second.manifest.manifestSha256, first.manifest.manifestSha256);
});

test("detects prepared-audio tampering", async (context) => {
  const item = await fixture(context);
  const result = await prepareProject(item.project);
  await fsp.appendFile(result.analysisPath, Buffer.from("changed"));
  await assert.rejects(loadPreparedMedia(item.project), /changed after creation/);
});

test("refuses clips beyond the source duration", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-prepare-range-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "input.wav");
  const project = path.join(root, "project");
  await fsp.writeFile(source, pcmWav(1));
  await initializeProject({ source, project, clip: "00:00-00:02" });
  await assert.rejects(prepareProject(project), /beyond the source duration/);
});
