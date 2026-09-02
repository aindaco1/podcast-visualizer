import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSpeechProgressParser, cuesFromWords, loadSpeechAnalysis, runSpeechSidecar,
  SPEECH_PROGRESS_SCHEMA, validateSpeechAnalysis
} from "../src/speech.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO = "c".repeat(64);
const prepared = {
  prepare: {
    analysis: { sha256: AUDIO, durationMs: 5000 }
  }
};

function analysis() {
  return {
    schemaVersion: "podcast-visualizer-speech-v1",
    sourceAudioSha256: AUDIO,
    transcriptionEngine: {
      name: "FluidAudio Parakeet TDT", version: "0.15.5", model: "parakeet-tdt-0.6b-v3",
      modelVersion: "fixture", settingsVersion: "fixture-v1"
    },
    diarizationEngine: {
      name: "FluidAudio OfflineDiarizer", version: "0.15.5", model: "speaker-diarization-coreml",
      modelVersion: "fixture", settingsVersion: "fixture-v1"
    },
    transcript: {
      text: "Hello there. General Kenobi!", durationSeconds: 5, confidence: 0.95,
      tokens: [],
      words: [
        { text: "Hello", startsAtSeconds: 0.1, endsAtSeconds: 0.5 },
        { text: "there.", startsAtSeconds: 0.55, endsAtSeconds: 1 },
        { text: "General", startsAtSeconds: 2, endsAtSeconds: 2.5 },
        { text: "Kenobi!", startsAtSeconds: 2.55, endsAtSeconds: 3 }
      ]
    },
    speakerTurns: [
      { cluster: "speaker_A", startsAtSeconds: 0, endsAtSeconds: 1.1, confidence: 0.9 },
      { cluster: "speaker_B", startsAtSeconds: 1.9, endsAtSeconds: 3.1, confidence: 0.8 }
    ]
  };
}

test("accepts a bounded offline speech result and compiles readable cues", () => {
  const value = analysis();
  assert.equal(validateSpeechAnalysis(value, prepared), value);
  assert.deepEqual(cuesFromWords(value.transcript.words, 5000), [
    { startsAtMs: 100, endsAtMs: 1000, textMarkdown: "Hello there." },
    { startsAtMs: 2000, endsAtMs: 3000, textMarkdown: "General Kenobi!" }
  ]);
});

test("rejects source substitution, unknown engine fields, and impossible word timing", () => {
  assert.throws(
    () => validateSpeechAnalysis({ ...analysis(), sourceAudioSha256: "d".repeat(64) }, prepared),
    /identity/
  );
  const unknownEngine = analysis();
  unknownEngine.transcriptionEngine.downloadURL = "https://example.invalid";
  assert.throws(() => validateSpeechAnalysis(unknownEngine, prepared), /engine/);
  const badTiming = analysis();
  badTiming.transcript.words[1].startsAtSeconds = -1;
  assert.throws(() => validateSpeechAnalysis(badTiming, prepared), /word 2/);
  const badTokenOrder = analysis();
  badTokenOrder.transcript.tokens = [
    { text: "later", tokenId: 1, startsAtSeconds: 2, endsAtSeconds: 2.2, confidence: 0.9 },
    { text: "earlier", tokenId: 2, startsAtSeconds: 1, endsAtSeconds: 1.2, confidence: 0.9 }
  ];
  assert.throws(() => validateSpeechAnalysis(badTokenOrder, prepared), /token 2/);
});

test("confidence evidence failures explain recovery and preserved data", async (context) => {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-speech-load-"));
  context.after(() => fsp.rm(projectRoot, { recursive: true, force: true }));
  await fsp.mkdir(path.join(projectRoot, "analysis"));
  assert.equal(
    await loadSpeechAnalysis(projectRoot, prepared, { allowMissing: true }),
    null
  );
  const outside = path.join(projectRoot, "outside.json");
  await fsp.writeFile(outside, JSON.stringify(analysis()));
  await fsp.symlink(outside, path.join(projectRoot, "analysis", "speech.json"));
  await assert.rejects(
    loadSpeechAnalysis(projectRoot, prepared, { allowMissing: true }),
    (error) => /missing or unsafe/.test(error.message)
      && /existing media and review edits were preserved/.test(error.hint)
  );
  await fsp.unlink(path.join(projectRoot, "analysis", "speech.json"));
  await fsp.writeFile(path.join(projectRoot, "analysis", "speech.json"), "not json");
  await assert.rejects(
    loadSpeechAnalysis(projectRoot, prepared),
    (error) => /evidence is invalid/.test(error.message)
      && /existing media and review edits were preserved/.test(error.hint)
  );
  const unsafeTiming = analysis();
  unsafeTiming.transcript.tokens = [
    { text: "late", tokenId: 1, startsAtSeconds: 6, endsAtSeconds: 6.2, confidence: 0.9 }
  ];
  await fsp.writeFile(
    path.join(projectRoot, "analysis", "speech.json"),
    JSON.stringify(unsafeTiming)
  );
  await assert.rejects(
    loadSpeechAnalysis(projectRoot, prepared),
    (error) => /evidence is invalid/.test(error.message)
      && /existing media and review edits were preserved/.test(error.hint)
  );
});

test("cue compiler segments pauses and rebalances an avoidable orphan", () => {
  const words = Array.from({ length: 17 }, (_, index) => ({
    text: `word${index}`,
    startsAtSeconds: index * 0.2,
    endsAtSeconds: index * 0.2 + 0.15
  }));
  const cues = cuesFromWords(words, 5000);
  assert.equal(cues.length, 2);
  assert.ok(cues.every(({ textMarkdown }) => textMarkdown.split(" ").length > 1));
  assert.equal(
    cues.flatMap(({ textMarkdown }) => textMarkdown.split(" ")).length,
    words.length
  );
  assert.ok(cues[1].startsAtMs >= cues[0].endsAtMs);
});

test("cue compiler applies editorial normalization without mutating raw words", () => {
  const words = [
    { text: "in", startsAtSeconds: 0, endsAtSeconds: 0.2 },
    { text: "twenty", startsAtSeconds: 0.21, endsAtSeconds: 0.4 },
    { text: "twenty", startsAtSeconds: 0.41, endsAtSeconds: 0.6 },
    { text: "four,", startsAtSeconds: 0.61, endsAtSeconds: 0.8 },
    { text: "i", startsAtSeconds: 0.81, endsAtSeconds: 0.9 },
    { text: "started.", startsAtSeconds: 0.91, endsAtSeconds: 1.2 }
  ];
  const snapshot = structuredClone(words);

  assert.deepEqual(cuesFromWords(words, 2_000), [{
    startsAtMs: 0,
    endsAtMs: 1_200,
    textMarkdown: "In 2024, I started."
  }]);
  assert.deepEqual(words, snapshot);
});

test("cue compiler keeps clear speaker changes on separate lines", () => {
  const words = [
    { text: "First", startsAtSeconds: 0, endsAtSeconds: 0.2 },
    { text: "speaker", startsAtSeconds: 0.21, endsAtSeconds: 0.4 },
    { text: "Second", startsAtSeconds: 0.41, endsAtSeconds: 0.6 },
    { text: "speaker", startsAtSeconds: 0.61, endsAtSeconds: 0.8 }
  ];
  const speakerTurns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO,
    durationMs: 2_000,
    engine: analysis().diarizationEngine,
    rawTurns: [
      { cluster: "one", startsAtMs: 0, endsAtMs: 405, confidence: 1 },
      { cluster: "two", startsAtMs: 405, endsAtMs: 2_000, confidence: 1 }
    ]
  });

  assert.deepEqual(
    cuesFromWords(words, 2_000, { speakerTurns })
      .map(({ textMarkdown }) => textMarkdown),
    ["First speaker", "Second speaker"]
  );
});

test("parses bounded, sequenced speech progress across arbitrary chunks", () => {
  const events = [];
  const parser = createSpeechProgressParser((event) => events.push(event));
  parser.push(Buffer.from(`{"schemaVersion":"${SPEECH_PROGRESS_SCHEMA}","sequence":1,"phase":"transcription","fraction":0.`));
  parser.push(Buffer.from(`4}\n{"schemaVersion":"${SPEECH_PROGRESS_SCHEMA}","sequence":2,"phase":"diarization-finalizing"}\n`));
  parser.finish();
  assert.deepEqual(events, [
    { phase: "transcription", fraction: 0.4 },
    { phase: "diarization-finalizing" }
  ]);
});

test("rejects malformed or out-of-order speech progress", () => {
  const parser = createSpeechProgressParser(() => {});
  assert.throws(() => parser.push(Buffer.from(
    `{"schemaVersion":"${SPEECH_PROGRESS_SCHEMA}","sequence":2,"phase":"transcription","fraction":2}\n`
  )), /invalid progress/);
});

test("rejects a sidecar that exits without emitting measured progress", () => {
  const parser = createSpeechProgressParser(() => {});
  assert.throws(() => parser.finish(), /emitted no progress/);
});

test("ignores third-party stdout while parsing sidecar progress from descriptor 3", async () => {
  const events = [];
  const event = JSON.stringify({
    schemaVersion: SPEECH_PROGRESS_SCHEMA,
    sequence: 1,
    phase: "transcription",
    fraction: 0.25
  });
  await runSpeechSidecar(process.execPath, ["-e", [
    "const fs = require('node:fs');",
    "process.stdout.write('FluidAudio diagnostic output\\n');",
    `fs.writeSync(3, ${JSON.stringify(`${event}\n`)});`
  ].join("")], (detail) => events.push(detail));

  assert.deepEqual(events, [{ phase: "transcription", fraction: 0.25 }]);
});
