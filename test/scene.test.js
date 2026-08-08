import assert from "node:assert/strict";
import test from "node:test";

import { compileAss } from "../src/ass.js";
import { ASPECT_PRESETS, buildScene, validateScene } from "../src/scene.js";
import { SPEAKER_PALETTE } from "../src/speaker-turns.js";

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
    speakers: [{ id: "speaker-01", displayName: "Alonso" }],
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

function fillerInputs() {
  const projected = ["Before", "um", "after", "Uh"].map((text, index) => ({
    wordId: `word_fillerfixture_${index}`,
    text
  }));
  const transcript = {
    transcriptId: `transcript_${"f".repeat(24)}`,
    manifestSha256: "1".repeat(64),
    sourceAudioSha256: "2".repeat(64),
    durationMs: 3000,
    cues: [
      {
        id: "cue_000001", startsAtMs: 0, endsAtMs: 2200,
        textMarkdown: "Before um after", speakerLabel: "speaker-01", speakerConfirmed: true
      },
      {
        id: "cue_000002", startsAtMs: 2200, endsAtMs: 3000,
        textMarkdown: "Uh", speakerLabel: "speaker-01", speakerConfirmed: true
      }
    ],
    projection: {
      cues: [
        { cueId: "cue_000001", startsAtMs: 0, endsAtMs: 2200, words: projected.slice(0, 3) },
        { cueId: "cue_000002", startsAtMs: 2200, endsAtMs: 3000, words: projected.slice(3) }
      ]
    }
  };
  const starts = [100, 700, 1300, 2300];
  const alignment = {
    manifestSha256: "3".repeat(64),
    manifest: {
      alignmentRevisionId: `alignment_${"4".repeat(24)}`,
      candidateWords: projected.map((word, index) => ({
        ...word,
        cueId: index === 3 ? "cue_000002" : "cue_000001",
        startsAtMs: starts[index], endsAtMs: starts[index] + 200,
        timingOrigin: "forced_alignment"
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
    assert.ok([7, 8, 9].includes(first.cues[0].position.anchor));
    assert.ok(first.cues[0].position.x >= 0 && first.cues[0].position.x <= first.layout.width);
    assert.ok(first.cues[0].position.y >= 0 && first.cues[0].position.y <= first.layout.height);
    assert.ok(first.cues[0].lineBreakBeforeWordIndexes.every((index) => index > 1));
    assert.deepEqual(first.layout, ASPECT_PRESETS[aspect]);
    assert.ok(first.layout.fontSize >= 80);
  }
});

test("compiles safe ASS with speaker colors, exact karaoke starts, and subtle dust", () => {
  const scene = buildScene({ ...inputs(), aspect: "16:9", title: "Dust {Wave} \\ proof" });
  const ass = compileAss(scene);
  assert.match(ass, /PlayResX: 1920/);
  assert.match(ass, /Style: Speaker01/);
  assert.match(ass, /\\kt0\\k35/);
  assert.match(ass, /\\kt35\\k35/);
  assert.match(ass, /\\kt210\\k90/);
  assert.match(ass, /Dust Wave Episode 1|Dust \\{Wave\\}/);
  assert.match(ass, /\\move\(/);
  assert.match(ass, /\\an7\\pos\(134,194\)/);
  assert.doesNotMatch(ass, /speaker-01/);
});

test("cycles the six-color palette for manually added speakers", () => {
  const fixture = inputs();
  fixture.transcript.cues[0].speakerLabel = "speaker-07";
  const scene = buildScene({ ...fixture, aspect: "16:9", title: "Manual speaker" });
  assert.equal(scene.speakers[0].id, "speaker-07");
  assert.equal(scene.speakers[0].bright, SPEAKER_PALETTE[0].bright);
  assert.match(compileAss(scene), /Style: Speaker07/);
});

test("aligns fillers but omits them visually and holds visible words across their timing", () => {
  const scene = buildScene({ ...fillerInputs(), aspect: "16:9" });
  assert.equal(scene.rendererVersion, "ass-scene-v4");
  assert.deepEqual(scene.wordPresentation, {
    policyVersion: "non-visual-fillers-hold-v1",
    suppressFillers: true,
    holdUntilNextVisibleWord: true
  });
  assert.equal(scene.cues.length, 1);
  assert.deepEqual(scene.cues[0].words.map(({ text }) => text), ["Before", "after"]);
  assert.equal(scene.cues[0].words[0].startsAtMs, 2100);
  assert.equal(scene.cues[0].words[0].endsAtMs, 3300);
  assert.equal(scene.cues[0].words[1].endsAtMs, 5000);
  assert.doesNotMatch(compileAss(scene), /\b(?:um|Uh)\b/);
});

test("uses large reference-scale type, balanced character wrapping, and visible Dust Wave ASCII", () => {
  const scene = buildScene({ ...inputs(), aspect: "16:9" });
  assert.equal(scene.layout.fontSize, 92);
  assert.equal(scene.styleVersion, "dust-branded-v2");
  const ass = compileAss(scene);
  assert.match(ass, /Style: Speaker01,Inter Light,92/);
  assert.match(ass, /\[ Dust Wave \]/);
  assert.match(ass, /Dust Wave  \[A\/V\]/);
  assert.match(ass, /Visual system: dust-wave-transcript-v2/);
  assert.match(ass, /DUST WAVE PODCAST \/ TRANSCRIPT/);
  assert.match(ass, /Alonso.*\\N/);
  assert.ok((ass.match(/Dialogue: 0,/g) || []).length >= 75);
});

test("applies project names, logo evidence, and optional speaker labels", () => {
  const branding = {
    podcastName: "The Local Show",
    organizationName: "Acme Media",
    showSpeakerNames: true,
    logo: {
      relativePath: `branding/assets/logo_${"a".repeat(64)}.png`,
      bytes: 1024,
      sha256: "a".repeat(64),
      width: 1024,
      height: 1024
    }
  };
  const scene = buildScene({ ...inputs(), aspect: "16:9", branding });
  assert.deepEqual(scene.brand, branding);
  const ass = compileAss(scene);
  assert.match(ass, /\[ Acme Media \]/);
  assert.match(ass, /The Local Show \/ TRANSCRIPT/);
  assert.match(ass, /Alonso.*\\N/);

  const hidden = buildScene({
    ...inputs(), aspect: "16:9", branding: { ...branding, showSpeakerNames: false, logo: null }
  });
  assert.doesNotMatch(compileAss(hidden), /Alonso/);
});

test("rejects unknown scene fields and unusable word timing", () => {
  const fixture = inputs();
  const scene = buildScene({ ...fixture, aspect: "9:16" });
  assert.throws(() => validateScene({ ...scene, unsafe: true }), /unknown field/);
  const unsafePosition = structuredClone(scene);
  unsafePosition.cues[0].position.x = -1;
  assert.throws(() => validateScene(unsafePosition), /position/);
  const unsafePolicy = structuredClone(scene);
  unsafePolicy.wordPresentation.holdUntilNextVisibleWord = false;
  assert.throws(() => validateScene(unsafePolicy), /presentation policy/);
  const unsafeHold = structuredClone(scene);
  unsafeHold.cues[0].words[0].endsAtMs -= 1;
  assert.throws(() => validateScene(unsafeHold), /hold timing/);
  const unsafeBrand = structuredClone(scene);
  unsafeBrand.brand.logo = { relativePath: "../../logo.png" };
  assert.throws(() => validateScene(unsafeBrand), /logo/);
  fixture.alignment.manifest.candidateWords[0].startsAtMs = null;
  assert.throws(() => buildScene({ ...fixture, aspect: "16:9" }), /no usable alignment/);
});
