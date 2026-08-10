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
    assert.equal(first.cues[0].words[0].spokenStartsAtMs, 2000);
    assert.equal(first.cues[0].words[0].highlightStartsAtMs, 2000);
    assert.equal(first.cues[0].position.anchor, 7);
    assert.ok(first.cues[0].position.x >= 0 && first.cues[0].position.x <= first.layout.width);
    assert.ok(first.cues[0].position.y >= 0 && first.cues[0].position.y <= first.layout.height);
    assert.ok(first.cues[0].lineBreakBeforeWordIndexes.every((index) => index > 0));
    assert.ok(first.cues[0].lineWidths.length <= 2);
    assert.deepEqual(first.layout, ASPECT_PRESETS[aspect]);
    assert.ok(first.layout.fontSize >= 80);
    assert.equal(first.readability.metrics.maximumLines, first.cues[0].lineWidths.length);
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
  assert.match(ass, /Style: Plate/);
  assert.match(ass, /\\an7\\pos\(112,161\)/);
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
  assert.equal(scene.rendererVersion, "ass-scene-v5");
  assert.deepEqual(scene.wordPresentation, {
    policyVersion: "non-visual-fillers-hold-v1",
    presentationPolicyVersion: "timed-text-presentation-v1",
    punctuationPolicyVersion: "readability-punctuation-v1",
    fontMetricsVersion: "inter-regular-4.1-glyph-advance-v1",
    suppressFillers: true,
    holdUntilNextVisibleWord: true
  });
  assert.equal(scene.cues.length, 1);
  assert.deepEqual(scene.cues[0].words.map(({ text }) => text), ["Before", "after"]);
  assert.equal(scene.cues[0].words[0].spokenStartsAtMs, 2100);
  assert.equal(scene.cues[0].words[0].spokenEndsAtMs, 2300);
  assert.equal(scene.cues[0].words[0].highlightEndsAtMs, 3300);
  assert.equal(scene.cues[0].words[1].spokenEndsAtMs, 3500);
  assert.equal(scene.cues[0].words[1].highlightEndsAtMs, 5000);
  assert.equal(scene.readability.sourceWordCount, 4);
  assert.equal(scene.readability.visibleWordCount, 2);
  assert.equal(scene.readability.suppressedWordCount, 2);
  assert.doesNotMatch(compileAss(scene), /\b(?:um|Uh)\b/);
});

test("uses measured two-line type, a contrast plate, and visible Dust Wave ASCII", () => {
  const scene = buildScene({ ...inputs(), aspect: "16:9" });
  assert.equal(scene.layout.fontSize, 92);
  assert.equal(scene.styleVersion, "dust-branded-v3");
  const ass = compileAss(scene);
  assert.match(ass, /Style: Speaker01,Inter,92/);
  assert.match(ass, /\[ Dust Wave \]/);
  assert.match(ass, /Dust Wave  \[A\/V\]/);
  assert.match(ass, /Visual system: dust-wave-transcript-v3/);
  assert.match(ass, /DUST WAVE PODCAST \/ TRANSCRIPT/);
  assert.match(ass, /Alonso.*\\N/);
  assert.ok((ass.match(/Dialogue: 0,/g) || []).length >= 75);
  assert.match(ass, /Dialogue: 2,.*Plate/);
});

test("adds display-only restart punctuation while preserving aligned words and timing", () => {
  const fixture = inputs();
  const texts = ["I", "think", "I", "think", "we", "should", "ship."];
  fixture.transcript.cues[0].textMarkdown = texts.join(" ");
  fixture.transcript.projection.cues[0].words.forEach((word, index) => {
    word.text = texts[index].replace(/\W/gu, "");
  });
  fixture.alignment.manifest.candidateWords.forEach((word, index) => {
    word.text = texts[index].replace(/\W/gu, "");
  });

  const scene = buildScene({ ...fixture, aspect: "16:9" });
  const presented = scene.cues.flatMap(({ words }) => words);
  assert.deepEqual(presented.map(({ text }) => text), [
    "I", "think—", "I", "think", "we", "should", "ship."
  ]);
  assert.deepEqual(presented.map(({ sourceText }) => sourceText), texts);
  assert.deepEqual(scene.readability.punctuationOperations, [{
    afterWordId: "word_transcriptfixture_1",
    mark: "—",
    reason: "same-speaker-restart"
  }]);
  assert.equal(presented[1].spokenEndsAtMs, 2630);
  assert.equal(presented[1].highlightEndsAtMs, presented[2].highlightStartsAtMs);
  assert.match(compileAss(scene), /think—/);
});

test("keeps cue placement stable within a speaker turn and shifts only subtly at a speaker change", () => {
  const fixture = inputs();
  const firstWords = fixture.transcript.projection.cues[0].words.slice(0, 4);
  const secondWords = fixture.transcript.projection.cues[0].words.slice(4);
  fixture.transcript.speakers.push({ id: "speaker-02", displayName: "Guest" });
  fixture.transcript.cues = [
    {
      id: "cue_000001", startsAtMs: 0, endsAtMs: 1500,
      textMarkdown: "This is a small", speakerLabel: "speaker-01", speakerConfirmed: true
    },
    {
      id: "cue_000002", startsAtMs: 1500, endsAtMs: 3000,
      textMarkdown: "deterministic scene fixture.", speakerLabel: "speaker-02", speakerConfirmed: true
    }
  ];
  fixture.transcript.projection.cues = [
    { cueId: "cue_000001", startsAtMs: 0, endsAtMs: 1500, words: firstWords },
    { cueId: "cue_000002", startsAtMs: 1500, endsAtMs: 3000, words: secondWords }
  ];
  fixture.alignment.manifest.candidateWords.forEach((word, index) => {
    word.cueId = index < 4 ? "cue_000001" : "cue_000002";
  });

  const scene = buildScene({ ...fixture, aspect: "16:9" });
  assert.equal(scene.cues.length, 2);
  assert.equal(scene.cues[0].position.x, scene.cues[1].position.x);
  assert.ok(Math.abs(scene.cues[0].position.y - scene.cues[1].position.y) <= 24);
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
  unsafeHold.cues[0].words[0].highlightEndsAtMs -= 1;
  assert.throws(() => validateScene(unsafeHold), /timing/);
  const unsafePunctuation = structuredClone(scene);
  unsafePunctuation.cues[0].words[0].text += "!";
  assert.throws(() => validateScene(unsafePunctuation), /punctuation/);
  const unsafeBrand = structuredClone(scene);
  unsafeBrand.brand.logo = { relativePath: "../../logo.png" };
  assert.throws(() => validateScene(unsafeBrand), /logo/);
  fixture.alignment.manifest.candidateWords[0].startsAtMs = null;
  assert.throws(() => buildScene({ ...fixture, aspect: "16:9" }), /no usable alignment/);
});
