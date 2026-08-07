import assert from "node:assert/strict";
import test from "node:test";

import {
  approveReview, buildReviewDraft, EDITORIAL_POLICY, validateReviewDraft, validateReviewedRevision
} from "../src/review.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO = "b".repeat(64);

function speakers() {
  return buildSpeakerTurns({
    sourceAudioSha256: AUDIO,
    durationMs: 5000,
    engine: {
      name: "fluidaudio-offline",
      version: "0.15.5",
      model: "speaker-diarization-coreml",
      modelVersion: "fixture",
      settingsVersion: "offline-default-v1"
    },
    rawTurns: [
      { cluster: "host", startsAtMs: 0, endsAtMs: 2500, confidence: 0.9 },
      { cluster: "guest", startsAtMs: 2500, endsAtMs: 5000, confidence: 0.9 }
    ]
  });
}

function draft() {
  return buildReviewDraft({
    sourceAudioSha256: AUDIO,
    durationMs: 5000,
    transcription: {
      engine: "parakeet",
      version: "0.15.5",
      model: "parakeet-tdt-0.6b-v3-coreml",
      modelVersion: "fixture"
    },
    cues: [
      { startsAtMs: 0, endsAtMs: 2000, textMarkdown: "Welcome to the show." },
      { startsAtMs: 3000, endsAtMs: 5000, textMarkdown: "Thanks for having me." }
    ],
    speakerTurns: speakers()
  });
}

test("builds a speaker-aware review draft", () => {
  const value = draft();
  assert.equal(validateReviewDraft(value), value);
  assert.equal(value.cues[0].speakerLabel, "speaker-01");
  assert.equal(value.cues[1].speakerLabel, "speaker-02");
});

test("approval freezes corrected text, speakers, and stable words", async () => {
  const value = draft();
  const editedCues = value.cues.map((cue, index) => ({
    ...cue,
    textMarkdown: index === 0 ? "Welcome to Dust Wave." : cue.textMarkdown,
    speakerConfirmed: true
  }));
  const approved = await approveReview({
    draft: value,
    editedCues,
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(approved.editorialPolicy, EDITORIAL_POLICY);
  assert.equal(approved.cues[0].textMarkdown, "Welcome to Dust Wave.");
  assert.equal(approved.projection.wordCount, 8);
  assert.ok(approved.projection.cues[0].words.every(({ wordId }) => wordId.startsWith("word_")));
  assert.equal(await validateReviewedRevision(approved), approved);
  await assert.rejects(
    validateReviewedRevision({ ...approved, contentSha256: "0".repeat(64) }),
    /content hash/
  );
});

test("approval refuses unknown or unconfirmed speakers", async () => {
  const value = draft();
  await assert.rejects(approveReview({ draft: value, editedCues: value.cues }), /requires a confirmed/);
  const unknown = value.cues.map((cue) => ({ ...cue, speakerLabel: "unknown", speakerConfirmed: true }));
  await assert.rejects(approveReview({ draft: value, editedCues: unknown }), /requires a confirmed/);
});
