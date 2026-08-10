import assert from "node:assert/strict";
import test from "node:test";

import { buildAlignmentTranscriptProjection } from "@dustwave/timed-text/alignment";

import { sha256 } from "../src/canonical-json.js";
import {
  approveReview, buildReviewDraft, defaultReviewSpeakers, EDITORIAL_POLICY,
  validateReviewDraft, validateReviewedRevision
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
    speakers: defaultReviewSpeakers(value.speakers).map((speaker, index) => (
      index === 0 ? { ...speaker, displayName: "Alonso" } : speaker
    )),
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(approved.editorialPolicy, EDITORIAL_POLICY);
  assert.equal(approved.schemaVersion, "reviewed-transcript-revision-v3");
  assert.equal(approved.parentTranscriptId, null);
  assert.equal(approved.parentRevisionSha256, null);
  assert.equal(approved.cues[0].textMarkdown, "Welcome to Dust Wave.");
  assert.equal(approved.speakers[0].displayName, "Alonso");
  assert.equal(approved.projection.wordCount, 8);
  assert.ok(approved.projection.cues[0].words.every(({ wordId }) => wordId.startsWith("word_")));
  assert.equal(await validateReviewedRevision(approved), approved);
  await assert.rejects(
    validateReviewedRevision({ ...approved, contentSha256: "0".repeat(64) }),
    /content hash/
  );
});

test("approval reflows bounded same-speaker fragments before freezing the revision", async () => {
  const speakerTurns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO,
    durationMs: 5_000,
    engine: {
      name: "fluidaudio-offline",
      version: "0.15.5",
      model: "speaker-diarization-coreml",
      modelVersion: "fixture",
      settingsVersion: "offline-default-v1"
    },
    rawTurns: [
      { cluster: "host", startsAtMs: 0, endsAtMs: 5_000, confidence: 0.95 }
    ]
  });
  const value = buildReviewDraft({
    sourceAudioSha256: AUDIO,
    durationMs: 5_000,
    transcription: {
      engine: "parakeet",
      version: "0.15.5",
      model: "parakeet-tdt-0.6b-v3-coreml",
      modelVersion: "fixture"
    },
    cues: [
      { startsAtMs: 0, endsAtMs: 800, textMarkdown: "Because we" },
      { startsAtMs: 900, endsAtMs: 2_400, textMarkdown: "just got hit by KOB four." },
      { startsAtMs: 2_600, endsAtMs: 4_200, textMarkdown: "That was the largest station." }
    ],
    speakerTurns
  });
  const approved = await approveReview({
    draft: value,
    editedCues: value.cues.map((cue) => ({ ...cue, speakerConfirmed: true })),
    approvedAt: "2026-08-09T00:00:00.000Z"
  });

  assert.equal(approved.cues.length, 1);
  assert.equal(
    approved.cues[0].textMarkdown,
    "Because we just got hit by KOB four. That was the largest station."
  );
  assert.equal(approved.cues[0].startsAtMs, 0);
  assert.equal(approved.cues[0].endsAtMs, 4_200);
  assert.equal(approved.cues[0].speakerLabel, "speaker-01");
  assert.equal(approved.projection.wordCount, 13);
  assert.equal(await validateReviewedRevision(approved), approved);
});

test("approval applies bounded semantic boundary hints without rewriting dialogue", async () => {
  const speakerTurns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO,
    durationMs: 4_000,
    engine: {
      name: "fluidaudio-offline", version: "0.15.5", model: "fixture",
      modelVersion: "fixture", settingsVersion: "offline-default-v1"
    },
    rawTurns: [{ cluster: "host", startsAtMs: 0, endsAtMs: 4_000, confidence: 1 }]
  });
  const value = buildReviewDraft({
    sourceAudioSha256: AUDIO,
    durationMs: 4_000,
    transcription: {
      engine: "parakeet", version: "0.15.5", model: "fixture", modelVersion: "fixture"
    },
    cues: [
      { startsAtMs: 0, endsAtMs: 1_000, textMarkdown: "A complete thought." },
      { startsAtMs: 1_600, endsAtMs: 2_500, textMarkdown: "Another complete thought." }
    ],
    speakerTurns
  });
  const editedCues = value.cues.map((cue) => ({ ...cue, speakerConfirmed: true }));
  const approved = await approveReview({
    draft: value,
    editedCues,
    reflowBoundaryHints: [{ afterCueId: "cue_000001", action: "merge" }],
    approvedAt: "2026-08-09T00:00:00.000Z"
  });

  assert.equal(approved.cues.length, 1);
  assert.equal(approved.cues[0].textMarkdown, "A complete thought. Another complete thought.");
  assert.equal(approved.cues[0].startsAtMs, 0);
  assert.equal(approved.cues[0].endsAtMs, 2_500);
  await assert.rejects(approveReview({
    draft: value,
    editedCues,
    reflowBoundaryHints: [{ afterCueId: "cue_999999", action: "merge" }]
  }), /boundary hint 1/);
});

test("approval refuses unknown or unconfirmed speakers", async () => {
  const value = draft();
  await assert.rejects(approveReview({ draft: value, editedCues: value.cues }), /requires a confirmed/);
  const unknown = value.cues.map((cue) => ({ ...cue, speakerLabel: "unknown", speakerConfirmed: true }));
  await assert.rejects(approveReview({ draft: value, editedCues: unknown }), /requires a confirmed/);
});

test("approval accepts a manually added speaker beyond the diarizer limit", async () => {
  const value = draft();
  const speakers = Array.from({ length: 7 }, (_, index) => ({
    id: `speaker-${String(index + 1).padStart(2, "0")}`,
    displayName: index === 6 ? "Producer" : `Speaker ${index + 1}`
  }));
  const editedCues = value.cues.map((cue, index) => ({
    ...cue,
    speakerLabel: index === 0 ? "speaker-07" : cue.speakerLabel,
    speakerConfirmed: true
  }));
  const approved = await approveReview({
    draft: value,
    editedCues,
    speakers,
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(approved.cues[0].speakerLabel, "speaker-07");
  assert.equal(approved.speakers.at(-1).displayName, "Producer");
  assert.equal(await validateReviewedRevision(approved), approved);
});

test("continues to validate immutable version-one and version-two reviewed transcripts", async () => {
  const value = draft();
  const current = await approveReview({
    draft: value,
    editedCues: value.cues.map((cue) => ({ ...cue, speakerConfirmed: true })),
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  const content = {
    sourceAudioSha256: current.sourceAudioSha256,
    language: current.language,
    durationMs: current.durationMs,
    editorialPolicy: current.editorialPolicy,
    cues: current.cues
  };
  const contentSha256 = sha256(content);
  const transcriptId = `transcript_${contentSha256.slice(0, 24)}`;
  const projection = await buildAlignmentTranscriptProjection({
    transcriptId,
    contentSha256,
    language: current.language,
    cues: current.cues
  });
  const body = {
    schemaVersion: "reviewed-transcript-revision-v1",
    transcriptId,
    parentDraftSha256: current.parentDraftSha256,
    approvedAt: current.approvedAt,
    reviewer: current.reviewer,
    ...content,
    contentSha256,
    projection
  };
  const legacy = { ...body, manifestSha256: sha256(body) };
  assert.equal(await validateReviewedRevision(legacy), legacy);
  const versionTwoBody = {
    ...body,
    schemaVersion: "reviewed-transcript-revision-v2",
    speakers: current.speakers,
    contentSha256: current.contentSha256,
    transcriptId: current.transcriptId,
    projection: current.projection
  };
  const versionTwo = {
    ...versionTwoBody,
    manifestSha256: sha256(versionTwoBody)
  };
  assert.equal(await validateReviewedRevision(versionTwo), versionTwo);
});

test("continues to validate revisions created under the pre-reflow editorial policy", async () => {
  const value = draft();
  const current = await approveReview({
    draft: value,
    editedCues: value.cues.map((cue) => ({ ...cue, speakerConfirmed: true })),
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  const content = {
    sourceAudioSha256: current.sourceAudioSha256,
    language: current.language,
    durationMs: current.durationMs,
    editorialPolicy: "lightly-cleaned-verbatim-v1",
    speakers: current.speakers,
    cues: current.cues
  };
  const contentSha256 = sha256(content);
  const transcriptId = `transcript_${contentSha256.slice(0, 24)}`;
  const projection = await buildAlignmentTranscriptProjection({
    transcriptId,
    contentSha256,
    language: current.language,
    cues: current.cues
  });
  const body = {
    ...current,
    transcriptId,
    editorialPolicy: content.editorialPolicy,
    contentSha256,
    projection
  };
  delete body.manifestSha256;
  const legacyPolicyRevision = { ...body, manifestSha256: sha256(body) };

  assert.equal(
    await validateReviewedRevision(legacyPolicyRevision),
    legacyPolicyRevision
  );
});
