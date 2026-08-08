import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeNewJson } from "../src/files.js";
import { detectProjectStage } from "../src/project-status.js";
import { advanceActiveTranscript } from "../src/review-revisions.js";
import { approveReview, buildReviewDraft } from "../src/review.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const PROJECT_ID = "project_aaaaaaaaaaaaaaaa_20260807010203";
const AUDIO_HASH = "a".repeat(64);

async function reviewedFixture(root, text, parentRevision = null) {
  const turns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 1000,
    engine: {
      name: "fixture", version: "1", model: "fixture",
      modelVersion: "1", settingsVersion: "1"
    },
    rawTurns: [{ cluster: "one", startsAtMs: 0, endsAtMs: 1000, confidence: 1 }]
  });
  const draft = buildReviewDraft({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 1000,
    transcription: { engine: "fixture", version: "1", model: "fixture", modelVersion: "1" },
    cues: [{ startsAtMs: 0, endsAtMs: 1000, textMarkdown: "Original words." }],
    speakerTurns: turns
  });
  const approved = await approveReview({
    draft,
    editedCues: draft.cues.map((cue) => ({
      ...cue,
      textMarkdown: text,
      speakerConfirmed: true
    })),
    parentRevision,
    approvedAt: parentRevision ? "2026-08-08T00:00:00.000Z" : "2026-08-07T00:00:00.000Z"
  });
  await writeNewJson(
    path.join(root, "review", `${approved.transcriptId}-approved.json`),
    approved
  );
  await advanceActiveTranscript({
    projectRoot: root,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH,
    approved,
    expectedParent: parentRevision,
    updatedAt: approved.approvedAt
  });
  return approved;
}

test("detects the latest resumable immutable project stage", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-project-status-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  assert.equal(await detectProjectStage(root), "initialized");
  await fsp.writeFile(path.join(root, "prepare.json"), "{}");
  assert.equal(await detectProjectStage(root), "prepared");
  await fsp.mkdir(path.join(root, "review"));
  await fsp.writeFile(path.join(root, "review", "draft.json"), "{}");
  assert.equal(await detectProjectStage(root), "review_required");
  await fsp.writeFile(path.join(root, "review", `transcript_${"a".repeat(24)}-approved.json`), "{}");
  assert.equal(await detectProjectStage(root), "approved");
  await fsp.mkdir(path.join(root, "alignment"));
  await fsp.writeFile(path.join(root, "alignment", `alignment_${"b".repeat(24)}-quality.json`), "{}");
  assert.equal(await detectProjectStage(root), "aligned");
  await fsp.mkdir(path.join(root, "renders"));
  await fsp.writeFile(path.join(root, "renders", `render_${"c".repeat(24)}.json`), "{}");
  assert.equal(await detectProjectStage(root), "verified");
});

test("rejects symlink project stage markers", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-project-status-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const outside = path.join(root, "outside.json");
  await fsp.writeFile(outside, "{}");
  await fsp.symlink(outside, path.join(root, "prepare.json"));
  await assert.rejects(detectProjectStage(root), /stage marker is unsafe/);
});

test("ignores downstream evidence that belongs to an inactive transcript revision", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-project-status-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, "review"));
  const first = await reviewedFixture(root, "First approved words.");
  const alignmentId = `alignment_${"b".repeat(24)}`;
  await fsp.mkdir(path.join(root, "alignment"));
  await writeNewJson(path.join(root, "alignment", `${alignmentId}-request.json`), {
    alignmentRevisionId: alignmentId,
    transcript: {
      contentSha256: first.contentSha256,
      projectionSha256: first.projection.projectionSha256
    }
  });
  await writeNewJson(path.join(root, "alignment", `${alignmentId}-quality.json`), {
    alignmentRevisionId: alignmentId
  });
  await fsp.mkdir(path.join(root, "scenes"));
  const sceneId = `scene_${"c".repeat(24)}`;
  const sceneDigest = "d".repeat(64);
  await writeNewJson(path.join(root, "scenes", `${sceneId}.json`), {
    sceneId,
    inputs: {
      transcriptId: first.transcriptId,
      transcriptManifestSha256: first.manifestSha256,
      alignmentRevisionId: alignmentId
    },
    manifestSha256: sceneDigest
  });
  await fsp.mkdir(path.join(root, "renders"));
  await writeNewJson(path.join(root, "renders", `render_${"e".repeat(24)}.json`), {
    sceneId,
    sceneManifestSha256: sceneDigest
  });
  assert.equal(await detectProjectStage(root, { projectId: PROJECT_ID }), "verified");

  await reviewedFixture(root, "Second approved words.", first);
  assert.equal(await detectProjectStage(root, { projectId: PROJECT_ID }), "approved");
});
