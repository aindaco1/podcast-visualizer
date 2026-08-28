import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedReviewResult,
  summarizeApprovedTranscript
} from "../src/transcript-summary.js";

const digest = "a".repeat(64);

function transcript(speakers) {
  return {
    transcriptId: "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
    contentSha256: digest,
    manifestSha256: digest,
    projection: { wordCount: 42 },
    speakers,
    cues: [
      { speakerLabel: "speaker-01" },
      { speakerLabel: "speaker-02" }
    ]
  };
}

test("summarizes anonymous, recognized, and mixed speaker identities", () => {
  assert.deepEqual(summarizeApprovedTranscript(transcript([
    { id: "speaker-01", displayName: "Speaker 1" },
    { id: "speaker-02", displayName: "Speaker 2" }
  ])), { words: 42, speakers: 2, recognizedSpeakers: 0, cues: 2 });

  assert.deepEqual(summarizeApprovedTranscript(transcript([
    { id: "speaker-01", displayName: "David" },
    { id: "speaker-02", displayName: "Alonso" }
  ])), { words: 42, speakers: 2, recognizedSpeakers: 2, cues: 2 });

  assert.equal(summarizeApprovedTranscript(transcript([
    { id: "speaker-01", displayName: "David" },
    { id: "speaker-02", displayName: "Speaker 2" }
  ])).recognizedSpeakers, 1);

  assert.deepEqual(summarizeApprovedTranscript(transcript([
    { id: "speaker-01", displayName: "David" },
    { id: "speaker-02", displayName: "Alonso" },
    { id: "speaker-03", displayName: "Unused Producer" }
  ])), { words: 42, speakers: 2, recognizedSpeakers: 2, cues: 2 });
});

test("keeps legacy reviewed transcripts anonymous without inventing identities", () => {
  const legacy = transcript(undefined);
  assert.deepEqual(summarizeApprovedTranscript(legacy), {
    words: 42,
    speakers: 2,
    recognizedSpeakers: 0,
    cues: 2
  });
});

test("uses one approval-result shape for browser and native review flows", () => {
  const result = approvedReviewResult(transcript([
    { id: "speaker-01", displayName: "David" },
    { id: "speaker-02", displayName: "Alonso" }
  ]));
  assert.deepEqual(result, {
    state: "approved",
    transcriptId: "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
    contentSha256: digest,
    manifestSha256: digest,
    transcript: { words: 42, speakers: 2, recognizedSpeakers: 2, cues: 2 }
  });
});
