import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAlignment } from "../src/alignment.js";
import { writeNewJson } from "../src/files.js";
import { prepareProject } from "../src/prepare.js";
import { initializeProject } from "../src/project.js";
import { approveReview, buildReviewDraft } from "../src/review.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

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
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 10) * 1200), 44 + index * 2);
  }
  return buffer;
}

test("runs the pinned alignment runner and validates its immutable evidence", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-align-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "input.wav");
  const project = path.join(root, "project");
  await fsp.writeFile(source, pcmWav());
  await initializeProject({ source, project, clip: "00:00-00:01" });
  const prepared = await prepareProject(project);
  const durationMs = prepared.prepare.analysis.durationMs;
  const speakerTurns = buildSpeakerTurns({
    sourceAudioSha256: prepared.prepare.analysis.sha256,
    durationMs,
    engine: {
      name: "fixture", version: "1", model: "fixture", modelVersion: "1", settingsVersion: "1"
    },
    rawTurns: [{ cluster: "one", startsAtMs: 0, endsAtMs: durationMs, confidence: 0.9 }]
  });
  const draft = buildReviewDraft({
    sourceAudioSha256: prepared.prepare.analysis.sha256,
    durationMs,
    transcription: { engine: "fixture", version: "1", model: "fixture", modelVersion: "1" },
    cues: [{ startsAtMs: 0, endsAtMs: durationMs, textMarkdown: "A tested alignment fixture." }],
    speakerTurns
  });
  const approved = await approveReview({
    draft,
    editedCues: draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true })),
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  const reviewDirectory = path.join(project, "review");
  await fsp.mkdir(reviewDirectory, { mode: 0o700 });
  await writeNewJson(path.join(reviewDirectory, `${approved.transcriptId}-approved.json`), approved);

  const aligned = await runAlignment(project, { adapter: "fixture", allowFixture: true });
  assert.equal(aligned.alignment.quality.wordCount, 4);
  assert.equal(aligned.alignment.quality.interpolatedWordCount, 4);
  assert.equal(aligned.alignment.quality.structurallyEligible, false);
  assert.equal((await fsp.stat(aligned.resultPath)).mode & 0o777, 0o600);
  const reused = await runAlignment(project, { adapter: "fixture", allowFixture: true });
  assert.equal(reused.alignment.manifestSha256, aligned.alignment.manifestSha256);
});
