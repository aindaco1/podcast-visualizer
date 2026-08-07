import assert from "node:assert/strict";
import test from "node:test";

import { cuesFromWords, validateSpeechAnalysis } from "../src/speech.js";

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
});

test("cue compiler segments pauses and enforces the presentation length cap", () => {
  const words = Array.from({ length: 17 }, (_, index) => ({
    text: `word${index}`,
    startsAtSeconds: index * 0.2,
    endsAtSeconds: index * 0.2 + 0.15
  }));
  const cues = cuesFromWords(words, 5000);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].textMarkdown.split(" ").length, 16);
  assert.ok(cues[1].startsAtMs >= cues[0].endsAtMs);
});
