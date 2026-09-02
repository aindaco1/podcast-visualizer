import assert from "node:assert/strict";
import test from "node:test";

import { summarizeConfidenceCalibration } from "../scripts/calibrate-transcript-confidence.mjs";

function cue(id, textMarkdown, startsAtMs, endsAtMs) {
  return { id, textMarkdown, startsAtMs, endsAtMs };
}

test("calibration reports aggregate spoken-word corrections without retaining text", () => {
  const draftCues = [
    cue("cue_000001", "Hello, WORLD!", 0, 1000),
    cue("cue_000002", "A mistaken ward appears here.", 1000, 2000),
    cue("cue_000003", "This sentence stays correct and quite long today.", 2000, 3000)
  ];
  const reviewedCues = [
    cue("cue_000001", "hello world", 0, 1000),
    cue("cue_000002", "A mistaken word appears here.", 1000, 2000),
    cue("cue_000003", "This sentence stays correct and quite long today.", 2000, 3000)
  ];
  const report = summarizeConfidenceCalibration([{
    draftCues,
    reviewedCues,
    confidence: { cues: [
      { cueId: "cue_000001", tier: "high" },
      { cueId: "cue_000002", tier: "low" },
      { cueId: "cue_000003", tier: "medium" }
    ] }
  }]);
  assert.equal(report.correctedCueCount, 1);
  assert.equal(report.tiers.low.correctedCues, 1);
  assert.equal(report.priorityQueue.correctionRecall, 1);
  assert.equal(report.mediumHighFalseNegatives.correctedCues, 0);
  assert.doesNotMatch(JSON.stringify(report), /Hello|mistaken|sentence|ward|word/);
});

test("calibration refuses structural edits that could create misleading labels", () => {
  assert.throws(() => summarizeConfidenceCalibration([{
    draftCues: [cue("cue_000001", "one two", 0, 1000)],
    reviewedCues: [cue("cue_000002", "one two", 0, 1000)],
    confidence: { cues: [{ cueId: "cue_000002", tier: "high" }] }
  }]), /unchanged cue identities and timing/);
});
