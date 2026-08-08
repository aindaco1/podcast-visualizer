import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReviewDraft } from "../src/review.js";
import {
  approveEditedReview, loadReviewWorkspace, readReviewEditFile, REVIEW_EDIT_SCHEMA,
  REVIEW_WORKSPACE_SCHEMA, saveWorkingReview
} from "../src/review-workspace.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO_HASH = "d".repeat(64);

async function fixture(context) {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-review-workspace-"));
  context.after(() => fsp.rm(projectRoot, { recursive: true, force: true }));
  await fsp.mkdir(path.join(projectRoot, "review"));
  const audioPath = path.join(projectRoot, "review.wav");
  await fsp.writeFile(audioPath, "local audio");
  const turns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 4000,
    engine: {
      name: "fluidaudio-offline", version: "0.15.5", model: "fixture",
      modelVersion: "fixture", settingsVersion: "fixture-v1"
    },
    rawTurns: [
      { cluster: "a", startsAtMs: 0, endsAtMs: 2000, confidence: 1 },
      { cluster: "b", startsAtMs: 2000, endsAtMs: 4000, confidence: 1 }
    ]
  });
  const draft = buildReviewDraft({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 4000,
    transcription: { engine: "parakeet", version: "0.15.5", model: "fixture", modelVersion: "fixture" },
    cues: [
      { startsAtMs: 0, endsAtMs: 1800, textMarkdown: "Lucid link is local." },
      { startsAtMs: 2200, endsAtMs: 4000, textMarkdown: "Keep it that way." }
    ],
    speakerTurns: turns
  });
  return { projectRoot, audioPath, draft };
}

test("loads the draft and restores an authenticated working copy", async (context) => {
  const { projectRoot, audioPath, draft } = await fixture(context);
  const first = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.equal(first.schemaVersion, REVIEW_WORKSPACE_SCHEMA);
  assert.equal(first.hasWorkingCopy, false);
  const cues = draft.cues.map((cue, index) => ({
    ...cue,
    textMarkdown: index === 0 ? "LucidLink is local." : cue.textMarkdown,
    speakerConfirmed: true
  }));
  const saved = await saveWorkingReview({
    projectRoot, draft, editedCues: cues, savedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.match(saved.workingSha256, /^[a-f0-9]{64}$/);
  const restored = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.equal(restored.hasWorkingCopy, true);
  assert.equal(restored.cues[0].textMarkdown, "LucidLink is local.");
  const stored = JSON.parse(await fsp.readFile(path.join(projectRoot, "review", "working.json"), "utf8"));
  assert.equal(stored.schemaVersion, "podcast-visualizer-review-working-v1");
  assert.match(stored.manifestSha256, /^[a-f0-9]{64}$/);
});

test("rejects unsafe or mismatched native edit files", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  const editPath = path.join(projectRoot, "edit.json");
  const edit = {
    schemaVersion: REVIEW_EDIT_SCHEMA,
    parentDraftSha256: draft.manifestSha256,
    cues: draft.cues,
    unexpected: true
  };
  await fsp.writeFile(editPath, JSON.stringify(edit));
  await assert.rejects(readReviewEditFile(editPath, draft), /unknown field/);
  await assert.rejects(readReviewEditFile("edit.json", draft), /absolute file path/);
  const linkPath = path.join(projectRoot, "edit-link.json");
  await fsp.symlink(editPath, linkPath);
  await assert.rejects(readReviewEditFile(linkPath, draft), /not a symlink/);
});

test("never follows an existing working-copy symlink", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  const outside = path.join(projectRoot, "outside.json");
  await fsp.writeFile(outside, "preserve me");
  await fsp.symlink(outside, path.join(projectRoot, "review", "working.json"));
  await assert.rejects(
    saveWorkingReview({ projectRoot, draft, editedCues: draft.cues }),
    /working copy is unsafe/
  );
  assert.equal(await fsp.readFile(outside, "utf8"), "preserve me");
});

test("native approval creates an immutable reviewed revision", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  const cues = draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true }));
  const approved = await approveEditedReview({
    projectRoot, draft, editedCues: cues, approvedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.match(approved.transcriptId, /^transcript_[a-f0-9]{24}$/);
  await assert.rejects(
    approveEditedReview({
      projectRoot, draft, editedCues: cues, approvedAt: "2026-08-07T00:00:00.000Z"
    }),
    /EEXIST/
  );
});
