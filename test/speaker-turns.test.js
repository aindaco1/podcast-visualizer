import assert from "node:assert/strict";
import test from "node:test";

import { buildSpeakerTurns, speakerForWindow, validateSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO = "a".repeat(64);
const ENGINE = {
  name: "fluidaudio-offline",
  version: "0.15.5",
  model: "speaker-diarization-coreml",
  modelVersion: "fixture",
  settingsVersion: "offline-default-v1"
};

function document() {
  return buildSpeakerTurns({
    sourceAudioSha256: AUDIO,
    durationMs: 10000,
    engine: ENGINE,
    rawTurns: [
      { cluster: "cluster-z", startsAtMs: 0, endsAtMs: 4000, confidence: 0.9 },
      { cluster: "cluster-a", startsAtMs: 4000, endsAtMs: 10000, confidence: 0.8 }
    ]
  });
}

test("assigns deterministic anonymous speakers by first appearance", () => {
  const value = document();
  assert.deepEqual(value.speakers.map(({ id }) => id), ["speaker-01", "speaker-02"]);
  assert.equal(value.turns[0].speakerId, "speaker-01");
  assert.equal(value.turns[1].speakerId, "speaker-02");
  assert.equal(validateSpeakerTurns(value), value);
});

test("attributes windows and marks close overlaps ambiguous", () => {
  const value = document();
  assert.deepEqual(speakerForWindow(0, 3000, value).speakerId, "speaker-01");
  assert.equal(speakerForWindow(3500, 4500, value).speakerId, "unknown");
});

test("rejects too many speakers and tampering", () => {
  const rawTurns = Array.from({ length: 7 }, (_, index) => ({
    cluster: `c${index}`,
    startsAtMs: index * 100,
    endsAtMs: index * 100 + 90,
    confidence: 1
  }));
  assert.throws(() => buildSpeakerTurns({ sourceAudioSha256: AUDIO, durationMs: 1000, engine: ENGINE, rawTurns }), /more than 6/);
  assert.throws(() => validateSpeakerTurns({ ...document(), manifestSha256: "0".repeat(64) }), /hash/);
});
