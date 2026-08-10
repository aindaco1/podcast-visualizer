import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DIALOGUE_REFLOW_POLICY, reflowDialogueCues
} from "@dustwave/timed-text/dialogue";

function cue(startsAtMs, endsAtMs, textMarkdown, speakerLabel = "speaker-01") {
  return { startsAtMs, endsAtMs, textMarkdown, speakerLabel };
}

test("reflows same-speaker fragments without changing words or timing evidence", () => {
  const input = [
    cue(0, 800, "Because we"),
    cue(900, 2_400, "just got hit by KOB four."),
    cue(2_600, 4_200, "That was the largest station."),
  ];
  const snapshot = structuredClone(input);

  assert.deepEqual(reflowDialogueCues(input, { durationMs: 5_000 }), [
    cue(0, 4_200, "Because we just got hit by KOB four. That was the largest station."),
  ]);
  assert.deepEqual(input, snapshot);
});

test("treats an acoustic speaker change as a hard dialogue boundary", () => {
  const input = [
    cue(0, 1_000, "Are you ready?", "speaker-01"),
    cue(1_050, 1_800, "Yes, I am.", "speaker-02"),
  ];

  assert.deepEqual(reflowDialogueCues(input, { durationMs: 2_000 }), input);
});

test("keeps complete dialogue lines separate when merging would exceed readability bounds", () => {
  const input = [
    cue(0, 4_000, "This complete thought already contains enough words to stand on its own."),
    cue(4_100, 8_000, "This second complete thought also contains enough words to remain separate."),
  ];

  assert.deepEqual(reflowDialogueCues(input, { durationMs: 9_000 }), input);
});

test("refuses long pauses and malformed or unbounded inputs", () => {
  const separated = [
    cue(0, 500, "A fragment"),
    cue(2_000, 3_000, "that follows after a long pause."),
  ];
  assert.deepEqual(reflowDialogueCues(separated, { durationMs: 4_000 }), separated);
  assert.throws(() => reflowDialogueCues([
    { ...separated[0], unsafe: true },
  ], { durationMs: 4_000 }), /cue 1/);
  assert.throws(() => reflowDialogueCues(separated, {
    durationMs: 4_000,
    policy: { ...DEFAULT_DIALOGUE_REFLOW_POLICY, maximumMergeGapMs: -1 }
  }), /maximumMergeGapMs/);
});

test("reflows ten thousand cues in one bounded linear pass", () => {
  const input = Array.from({ length: 10_000 }, (_, index) => (
    cue(index * 2, index * 2 + 1, `word${index}`)
  ));
  const result = reflowDialogueCues(input, { durationMs: 20_000 });

  assert.ok(result.length < input.length / 10);
  assert.equal(
    result.reduce((count, item) => count + item.textMarkdown.split(" ").length, 0),
    input.length
  );
  assert.equal(result[0].startsAtMs, 0);
  assert.equal(result.at(-1).endsAtMs, 19_999);
});
