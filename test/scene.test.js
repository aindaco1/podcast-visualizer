import assert from "node:assert/strict";
import test from "node:test";

import { compileAss } from "../src/ass.js";
import { ASPECT_PRESETS, buildScene, validateScene } from "../src/scene.js";

function inputs() {
  const projectionWords = ["This", "is", "a", "small", "deterministic", "scene", "fixture."].map((text, index) => ({
    wordId: `word_transcriptfixture_${index}`,
    text: text.replace(/\W/g, "")
  }));
  const transcript = {
    transcriptId: `transcript_${"a".repeat(24)}`,
    manifestSha256: "b".repeat(64),
    sourceAudioSha256: "c".repeat(64),
    durationMs: 3000,
    cues: [{
      id: "cue_000001", startsAtMs: 0, endsAtMs: 3000,
      textMarkdown: "This is a small deterministic scene fixture.",
      speakerLabel: "speaker-01", speakerConfirmed: true
    }],
    projection: {
      cues: [{ cueId: "cue_000001", startsAtMs: 0, endsAtMs: 3000, words: projectionWords }]
    }
  };
  const alignment = {
    manifestSha256: "d".repeat(64),
    manifest: {
      alignmentRevisionId: `alignment_${"e".repeat(24)}`,
      candidateWords: projectionWords.map((word, index) => ({
        ...word, cueId: "cue_000001", startsAtMs: index * 350,
        endsAtMs: index * 350 + 280, timingOrigin: "forced_alignment"
      }))
    },
    quality: { structurallyEligible: true }
  };
  return { transcript, alignment };
}

test("builds deterministic aspect-specific scene manifests", () => {
  const fixture = inputs();
  for (const aspect of Object.keys(ASPECT_PRESETS)) {
    const first = buildScene({ ...fixture, aspect, title: "Dust Wave Episode 1" });
    const second = buildScene({ ...fixture, aspect, title: "Dust Wave Episode 1" });
    assert.deepEqual(first, second);
    assert.equal(validateScene(first), first);
    assert.equal(first.cues[0].words[0].startsAtMs, 2000);
    assert.ok(first.cues[0].lineBreakBeforeWordIndexes.every((index) => index > 1));
    assert.deepEqual(first.layout, ASPECT_PRESETS[aspect]);
  }
});

test("compiles safe ASS with speaker colors, exact karaoke starts, and subtle dust", () => {
  const scene = buildScene({ ...inputs(), aspect: "16:9", title: "Dust {Wave} \\ proof" });
  const ass = compileAss(scene);
  assert.match(ass, /PlayResX: 1920/);
  assert.match(ass, /Style: Speaker01/);
  assert.match(ass, /\\kt0\\k28/);
  assert.match(ass, /\\kt35\\k28/);
  assert.match(ass, /Dust Wave Episode 1|Dust \\{Wave\\}/);
  assert.match(ass, /\\move\(/);
  assert.doesNotMatch(ass, /speaker-01/);
});

test("rejects unknown scene fields and unusable word timing", () => {
  const fixture = inputs();
  const scene = buildScene({ ...fixture, aspect: "9:16" });
  assert.throws(() => validateScene({ ...scene, unsafe: true }), /unknown field/);
  fixture.alignment.manifest.candidateWords[0].startsAtMs = null;
  assert.throws(() => buildScene({ ...fixture, aspect: "16:9" }), /no usable alignment/);
});
