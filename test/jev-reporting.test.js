import assert from "node:assert/strict";
import test from "node:test";
import { summarize, exitCode, reviewMarkdown } from "../scripts/jev-evaluation.mjs";
import { reflowFailures } from "../scripts/jev-corpus.mjs";

test("combined results cannot call an exact failure a pass even when the judge approves it", () => {
  const corpus = [{ id: "broken", kind: "native-reflow", candidate: "synthetic", reference: "synthetic",
    requirements: { meaning: "Preserve meaning" }, deterministicFailures: ["fragment-grouping"] }];
  const report = { complete: true, networkAttempts: 1, cases: [{ id: "broken", result: {
    usage: { input_tokens: 1 }, findings: { meaning: { decision: "pass", probabilities: { pass: 1, fail: 0, uncertain: 0 } } }
  } }] };
  const summary = summarize(report, corpus);
  assert.equal(summary.candidates.pass, 0);
  assert.equal(summary.candidates.fail, 1);
  assert.equal(summary.semanticCandidates.pass, 1);
  assert.deepEqual(summary.judgeExactDisagreements, ["broken"]);
  assert.equal(summary.reviewQueue[0].id, "broken");
  assert.equal(summary.reviewQueue[0].reason, "exact-failure");
  assert.equal(exitCode(report, summary, { live: true }), 1);
  assert.match(reviewMarkdown(report, corpus, summary), /Combined result: fail/);
});

test("structural controls are evaluated locally and preserve failures missed by an exact check", () => {
  const corpus = [
    { id: "good", kind: "control", exactOnly: true, expected: "pass", deterministicFailures: [] },
    { id: "bad", kind: "control", exactOnly: true, expected: "fail", deterministicFailures: ["cue-groups"] },
    { id: "missed", kind: "control", exactOnly: true, expected: "fail", deterministicFailures: [] }
  ];
  const report = { complete: true, cases: [] };
  const summary = summarize(report, corpus);
  assert.equal(summary.exactControls.correct, 2);
  assert.equal(summary.exactControls.falsePasses, 1);
  assert.equal(summary.controls.unevaluated, 0);
  assert.equal(summary.reviewQueue[0].id, "missed");
  assert.equal(exitCode(report, summary, { live: false }), 1);
});

test("timing checks reject moving words across cue timestamps even if concatenated text is unchanged", () => {
  const input = [
    { startsAtMs: 0, endsAtMs: 1000, speakerLabel: "speaker-01", textMarkdown: "Do not" },
    { startsAtMs: 1000, endsAtMs: 2000, speakerLabel: "speaker-01", textMarkdown: "delete it." }
  ];
  const output = [{ ...input[0], textMarkdown: "Do" }, { ...input[1], textMarkdown: "not delete it." }];
  assert.ok(reflowFailures(input, output).includes("cue-word-association"));
  const unicode = [{ ...input[0], textMarkdown: "🎙".repeat(100) }];
  assert.deepEqual(reflowFailures(unicode, unicode), []);
});
