import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../src/canonical-json.js";
import { approveReview, buildReviewDraft, defaultReviewSpeakers } from "../src/review.js";
import { writeNewJson } from "../src/files.js";
import {
  approveEditedReview, loadReviewWorkspace, readReviewEditFile, REVIEW_EDIT_SCHEMA,
  REVIEW_WORKSPACE_SCHEMA, saveWorkingReview
} from "../src/review-workspace.js";
import { resolveActiveTranscript } from "../src/review-revisions.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO_HASH = "d".repeat(64);
const PROJECT_ID = "project_dddddddddddddddd_20260807010203";

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
  assert.equal(first.speakers[0].displayName, "Speaker 1");
  const speakers = [
    { ...first.speakers[0], displayName: "Alonso" },
    ...first.speakers.slice(1),
    { id: "speaker-03", displayName: "Producer" }
  ];
  const cues = draft.cues.map((cue, index) => ({
    ...cue,
    textMarkdown: index === 0 ? "LucidLink is local." : cue.textMarkdown,
    speakerConfirmed: true
  }));
  const saved = await saveWorkingReview({
    projectRoot, draft, editedCues: cues, speakers, savedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.match(saved.workingSha256, /^[a-f0-9]{64}$/);
  const restored = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.equal(restored.hasWorkingCopy, true);
  assert.equal(restored.cues[0].textMarkdown, "LucidLink is local.");
  assert.deepEqual(restored.speakers, speakers);
  const stored = JSON.parse(await fsp.readFile(path.join(projectRoot, "review", "working.json"), "utf8"));
  assert.equal(stored.schemaVersion, "podcast-visualizer-review-working-v3");
  assert.equal(stored.baseTranscriptId, null);
  assert.match(stored.manifestSha256, /^[a-f0-9]{64}$/);
});

test("persists manually added speakers beyond the diarizer palette size", async (context) => {
  const { projectRoot, audioPath, draft } = await fixture(context);
  const speakers = Array.from({ length: 7 }, (_, index) => ({
    id: `speaker-${String(index + 1).padStart(2, "0")}`,
    displayName: index === 6 ? "Producer" : `Speaker ${index + 1}`
  }));
  const cues = draft.cues.map((cue, index) => ({
    ...cue,
    speakerLabel: index === 0 ? "speaker-07" : cue.speakerLabel,
    speakerConfirmed: true
  }));
  await saveWorkingReview({ projectRoot, draft, editedCues: cues, speakers });
  const restored = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.equal(restored.speakers.at(-1).id, "speaker-07");
  assert.equal(restored.speakers.at(-1).displayName, "Producer");
  assert.equal(restored.cues[0].speakerLabel, "speaker-07");
});

test("persists deletion of every speaker with assigned cues moved to unknown", async (context) => {
  const { projectRoot, audioPath, draft } = await fixture(context);
  const cues = draft.cues.map((cue) => ({
    ...cue,
    speakerLabel: "unknown",
    speakerConfirmed: false,
    speakerAmbiguous: true
  }));
  await saveWorkingReview({ projectRoot, draft, editedCues: cues, speakers: [] });
  const restored = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.deepEqual(restored.speakers, []);
  assert.ok(restored.cues.every(({ speakerLabel }) => speakerLabel === "unknown"));
});

test("rejects unsafe or mismatched native edit files", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  const editPath = path.join(projectRoot, "edit.json");
  const edit = {
    schemaVersion: REVIEW_EDIT_SCHEMA,
    parentDraftSha256: draft.manifestSha256,
    speakers: defaultReviewSpeakers(draft.speakers),
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

test("migrates a version-one working copy to default speaker names", async (context) => {
  const { projectRoot, audioPath, draft } = await fixture(context);
  const body = {
    schemaVersion: "podcast-visualizer-review-working-v1",
    parentDraftSha256: draft.manifestSha256,
    savedAt: "2026-08-07T00:00:00.000Z",
    cues: draft.cues
  };
  await fsp.writeFile(
    path.join(projectRoot, "review", "working.json"),
    JSON.stringify({ ...body, manifestSha256: sha256(body) })
  );
  const restored = await loadReviewWorkspace({ projectRoot, audioPath, draft });
  assert.deepEqual(restored.speakers, defaultReviewSpeakers(draft.speakers));
  assert.equal(restored.hasWorkingCopy, true);

  const editPath = path.join(projectRoot, "version-one-edit.json");
  await fsp.writeFile(editPath, JSON.stringify({
    schemaVersion: "podcast-visualizer-review-edit-v1",
    parentDraftSha256: draft.manifestSha256,
    cues: draft.cues
  }));
  const edit = await readReviewEditFile(editPath, draft);
  assert.deepEqual(edit.speakers, defaultReviewSpeakers(draft.speakers));
});

test("rejects invalid speaker definitions and undeclared cue speakers", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  await assert.rejects(
    saveWorkingReview({
      projectRoot,
      draft,
      editedCues: draft.cues,
      speakers: [{ id: "speaker-01", displayName: "Alonso\nInjected" }]
    }),
    /review speakers are invalid/
  );
  await assert.rejects(
    saveWorkingReview({
      projectRoot,
      draft,
      editedCues: draft.cues.map((cue) => ({ ...cue, speakerLabel: "speaker-03" })),
      speakers: defaultReviewSpeakers(draft.speakers)
    }),
    /review edit cue 1 is invalid/
  );
  await assert.rejects(
    saveWorkingReview({
      projectRoot,
      draft,
      editedCues: draft.cues,
      speakers: [{ id: "speaker-100", displayName: "Overflow" }]
    }),
    /review speakers are invalid/
  );
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
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH,
    draft,
    editedCues: cues,
    speakers: [
      { id: "speaker-01", displayName: "Alonso" },
      { id: "speaker-02", displayName: "Guest" }
    ],
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.match(approved.transcriptId, /^transcript_[a-f0-9]{24}$/);
  assert.equal(approved.speakers[0].displayName, "Alonso");
  await assert.rejects(
    approveEditedReview({
      projectRoot,
      projectId: PROJECT_ID,
      sourceAudioSha256: AUDIO_HASH,
      draft,
      editedCues: cues,
      speakers: approved.speakers,
      approvedAt: "2026-08-07T00:00:00.000Z"
    }),
    /EEXIST/
  );
});

test("editing an approved transcript creates a child revision and advances the active pointer", async (context) => {
  const { projectRoot, audioPath, draft } = await fixture(context);
  const cues = draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true }));
  const first = await approveEditedReview({
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH,
    draft,
    editedCues: cues,
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  const firstPath = path.join(projectRoot, "review", `${first.transcriptId}-approved.json`);
  const firstBytes = await fsp.readFile(firstPath);
  const workspace = await loadReviewWorkspace({
    projectRoot,
    audioPath,
    draft,
    baseRevision: first
  });
  assert.equal(workspace.baseTranscriptId, first.transcriptId);
  assert.equal(workspace.baseRevisionSha256, first.manifestSha256);
  assert.ok(workspace.cues.every(({ speakerConfirmed }) => speakerConfirmed));
  const revisedCues = workspace.cues.map((cue, index) => ({
    ...cue,
    textMarkdown: index === 0 ? "LucidLink is local." : cue.textMarkdown
  }));
  const editPath = path.join(projectRoot, "revision-edit.json");
  await fsp.writeFile(editPath, JSON.stringify({
    schemaVersion: REVIEW_EDIT_SCHEMA,
    parentDraftSha256: draft.manifestSha256,
    baseTranscriptId: first.transcriptId,
    baseRevisionSha256: first.manifestSha256,
    speakers: workspace.speakers,
    cues: revisedCues
  }));
  assert.equal(
    (await readReviewEditFile(editPath, draft, first)).baseTranscriptId,
    first.transcriptId
  );
  const second = await approveEditedReview({
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH,
    draft,
    editedCues: revisedCues,
    speakers: workspace.speakers,
    baseRevision: first,
    approvedAt: "2026-08-08T00:00:00.000Z"
  });
  assert.notEqual(second.transcriptId, first.transcriptId);
  assert.equal(second.parentTranscriptId, first.transcriptId);
  assert.equal(second.parentRevisionSha256, first.manifestSha256);
  assert.deepEqual(await fsp.readFile(firstPath), firstBytes);
  const active = await resolveActiveTranscript({
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH
  });
  assert.equal(active.transcript.transcriptId, second.transcriptId);
  assert.equal(active.pointer.parentTranscriptId, first.transcriptId);
  await assert.rejects(
    readReviewEditFile(editPath, draft, second),
    /does not match the active transcript revision/
  );
});

test("ambiguous legacy revisions fail without creating an active pointer", async (context) => {
  const { projectRoot, draft } = await fixture(context);
  const confirmed = draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true }));
  const first = await approveReview({
    draft,
    editedCues: confirmed,
    approvedAt: "2026-08-07T00:00:00.000Z"
  });
  const second = await approveReview({
    draft,
    editedCues: confirmed.map((cue, index) => ({
      ...cue,
      textMarkdown: index === 0 ? "A distinct revision." : cue.textMarkdown
    })),
    approvedAt: "2026-08-08T00:00:00.000Z"
  });
  for (const revision of [first, second]) {
    await writeNewJson(
      path.join(projectRoot, "review", `${revision.transcriptId}-approved.json`),
      revision
    );
  }
  await assert.rejects(resolveActiveTranscript({
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH
  }), /no active selection/);
  await assert.rejects(
    fsp.lstat(path.join(projectRoot, "review", "active-transcript.json")),
    { code: "ENOENT" }
  );
});
