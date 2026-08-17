import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAlignment } from "../src/alignment.js";
import {
  CHAPTER_EDIT_SCHEMA,
  approveChapterEdit,
  exportApprovedChapters,
  loadChapterWorkspace,
  saveChapterWorkingCopy
} from "../src/chapters.js";
import { writeNewJson } from "../src/files.js";
import { prepareProject } from "../src/prepare.js";
import { initializeProject } from "../src/project.js";
import { approveReview, buildReviewDraft } from "../src/review.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const FIXTURE_ALIGNMENT = { adapter: "fixture", allowFixture: true };

function pcmWav(durationSeconds = 50, sampleRate = 16_000) {
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
  return buffer;
}

async function alignedProject(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-chapters-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "input.wav");
  const project = path.join(root, "project");
  await fsp.writeFile(source, pcmWav());
  await initializeProject({ source, project, clip: "00:00-00:50" });
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
    cues: Array.from({ length: 5 }, (_, index) => ({
      startsAtMs: index * 10_000,
      endsAtMs: (index + 1) * 10_000,
      textMarkdown: `Reviewed topic ${index + 1} has aligned words.`
    })),
    speakerTurns
  });
  const approved = await approveReview({
    draft,
    editedCues: draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true })),
    approvedAt: "2026-08-17T00:00:00.000Z"
  });
  const reviewDirectory = path.join(project, "review");
  await fsp.mkdir(reviewDirectory, { mode: 0o700 });
  await writeNewJson(path.join(reviewDirectory, `${approved.transcriptId}-approved.json`), approved);
  await runAlignment(project, FIXTURE_ALIGNMENT);
  return { project, root };
}

test("persists bounded chapter review and immutable YouTube, Markdown, and JSON exports", async (context) => {
  const { project, root } = await alignedProject(context);
  const options = { mode: "topics", alignmentOptions: FIXTURE_ALIGNMENT };
  const workspace = await loadChapterWorkspace(project, options);
  const anchors = workspace.contextArtifact.context.windows
    .flatMap(({ records }) => records.map(({ anchorId }) => anchorId));
  assert.equal(workspace.contextArtifact.context.windows[0].records[0].startsAtMs, 0);
  assert.equal(workspace.edit.entries.length, 0);

  const edit = {
    schemaVersion: CHAPTER_EDIT_SCHEMA,
    contextId: workspace.contextArtifact.contextId,
    contextManifestSha256: workspace.contextArtifact.manifestSha256,
    entries: [
      { anchorId: anchors[0], title: "Opening" },
      { anchorId: anchors[2], title: "Production workflow" },
      { anchorId: anchors[4], title: "Release checklist" }
    ]
  };
  const input = path.join(root, "chapter-edit.json");
  await writeNewJson(input, edit);
  const saved = await saveChapterWorkingCopy(project, input, options);
  assert.deepEqual(saved.edit, edit);
  assert.equal((await fsp.stat(saved.workingPath)).mode & 0o777, 0o600);

  const approved = await approveChapterEdit(project, input, options);
  assert.equal(approved.list.chapters.length, 3);
  assert.equal((await fsp.stat(approved.revisionPath)).mode & 0o777, 0o600);

  const youtube = await exportApprovedChapters(project, {
    ...options, format: "youtube"
  });
  const markdown = await exportApprovedChapters(project, {
    ...options, format: "markdown"
  });
  const json = await exportApprovedChapters(project, {
    ...options, format: "json"
  });
  assert.equal(youtube.content, [
    "00:00 - Opening",
    "00:20 - Production workflow",
    "00:40 - Release checklist",
    ""
  ].join("\n"));
  assert.match(markdown.content, /\| 00:20 \| Production workflow \|/u);
  assert.deepEqual(JSON.parse(json.content), approved.list);
  assert.equal(
    (await exportApprovedChapters(project, { ...options, format: "youtube" })).outputPath,
    youtube.outputPath
  );
});

test("rejects stale, unexpected, and incomplete chapter edits without replacing saved work", async (context) => {
  const { project, root } = await alignedProject(context);
  const options = { alignmentOptions: FIXTURE_ALIGNMENT };
  const workspace = await loadChapterWorkspace(project, options);
  const firstAnchor = workspace.contextArtifact.context.windows[0].records[0].anchorId;
  const invalid = {
    schemaVersion: CHAPTER_EDIT_SCHEMA,
    contextId: workspace.contextArtifact.contextId,
    contextManifestSha256: workspace.contextArtifact.manifestSha256,
    entries: [{ anchorId: firstAnchor, title: "Opening" }],
    unexpected: true
  };
  const input = path.join(root, "invalid-edit.json");
  await writeNewJson(input, invalid);
  await assert.rejects(
    saveChapterWorkingCopy(project, input, options),
    /contains unexpected fields/u
  );
  const incomplete = path.join(root, "incomplete-edit.json");
  const { unexpected, ...bounded } = invalid;
  await writeNewJson(incomplete, bounded);
  await assert.rejects(
    approveChapterEdit(project, incomplete, options),
    (error) => error.exitCode === 3 && /saved chapter draft was preserved/u.test(error.hint)
  );
  const unsafe = path.join(root, "unsafe-edit.json");
  await writeNewJson(unsafe, {
    ...bounded,
    entries: [{ anchorId: firstAnchor, title: "unsafe\u202etitle" }]
  });
  await assert.rejects(
    saveChapterWorkingCopy(project, unsafe, options),
    (error) => error.exitCode === 2 && /drafts were preserved/u.test(error.hint)
  );
  const duplicate = path.join(root, "duplicate-edit.json");
  await writeNewJson(duplicate, {
    ...bounded,
    entries: [bounded.entries[0], bounded.entries[0]]
  });
  await assert.rejects(
    saveChapterWorkingCopy(project, duplicate, options),
    (error) => error.exitCode === 2 && /supplied timestamp/u.test(error.hint)
  );
  const unknown = path.join(root, "unknown-edit.json");
  await writeNewJson(unknown, {
    ...bounded,
    entries: [{ anchorId: "chapter_anchor_unknown", title: "Opening" }]
  });
  await assert.rejects(
    saveChapterWorkingCopy(project, unknown, options),
    (error) => error.exitCode === 2 && /drafts were preserved/u.test(error.hint)
  );
  const reloaded = await loadChapterWorkspace(project, options);
  assert.equal(reloaded.edit.entries.length, 0);
});

test("rejects a symlinked alignment directory before loading chapter evidence", async (context) => {
  const { project } = await alignedProject(context);
  const alignment = path.join(project, "alignment");
  const retained = path.join(project, "alignment-retained");
  await fsp.rename(alignment, retained);
  await fsp.symlink(retained, alignment);
  await assert.rejects(
    loadChapterWorkspace(project, { alignmentOptions: FIXTURE_ALIGNMENT }),
    (error) => error.exitCode === 3 && /files were preserved/u.test(error.hint)
  );
});
