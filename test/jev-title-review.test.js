import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJevRequest, evaluateJevCases } from "@dustwave/test-core/jev";
import { loadFixtures, localCorpus } from "../scripts/jev-corpus.mjs";
import { loadRubricFixtures, rubricCorpus, rubricMetrics, TITLE_HOLDOUT_FIXTURE } from "../scripts/jev-rubric-review.mjs";
import { main, parseOptions, POLICY, reserveBudget, summarize } from "../scripts/jev-evaluation.mjs";

const development = rubricCorpus(await loadRubricFixtures(undefined, "titles"));
const holdout = rubricCorpus(await loadRubricFixtures(undefined, "holdout"));
const focus = rubricCorpus(await loadRubricFixtures(undefined, "focus"));
const criteria = rubricCorpus(await loadRubricFixtures(undefined, "criteria"));
const criteriaReused = rubricCorpus(await loadRubricFixtures(undefined, "criteria-reused"));

test("explicit-criteria experiment changes only the subject rule on the same corrected targets", () => {
  for (const rows of [criteria, criteriaReused]) {
    assert.equal(reserveBudget(rows, 0.15).questions, 72);
    for (const row of rows.filter((row) => row.audit.variant === "explicit-purpose")) {
      const baseline = rows.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant === "current");
      assert.equal(row.reference, baseline.reference);
      assert.equal(row.candidate, baseline.candidate);
      assert.equal(row.expected, baseline.expected);
      assert.equal(row.requirements.grounding, baseline.requirements.grounding);
      assert.equal(row.requirements.style, baseline.requirements.style);
      assert.notEqual(row.requirements.subject, baseline.requirements.subject);
    }
  }
});

test("focus experiment changes only the names goal annotation and preserves consumed labels", () => {
  assert.equal(reserveBudget(focus, 0.15).questions, 72);
  for (const row of focus) {
    const original = holdout.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant === "current");
    assert.equal(row.expected, original.expected);
    assert.equal(row.reference, original.reference);
    assert.equal(row.candidate, original.candidate);
    assert.equal(row.requirements.grounding, original.requirements.grounding);
    assert.equal(row.requirements.style, original.requirements.style);
    if (row.audit.variant === "focus" && row.audit.caseId.startsWith("names-")) {
      assert.ok(row.requirements.subject.includes("Pronouncing names correctly"));
      assert.notEqual(row.requirements.subject, original.requirements.subject);
    } else assert.deepEqual(row.requirements, original.requirements);
    assert.equal(row.audit.partition, "development-consumed-holdout");
  }
});

test("title qualification changes only subject wording, preserving production request context", async () => {
  const controls = localCorpus(await loadFixtures());
  for (const rows of [development, holdout]) {
    assert.equal(rows.length, 24);
    assert.equal(reserveBudget(rows, 0.15).questions, 72);
    assert.deepEqual([0, 6, 12, 18].map((index) => rows[index].audit.variant), ["current", "purpose", "purpose", "current"]);
    for (const row of rows) {
      const request = createJevRequest(row.candidate, row.requirements, { reference: row.reference });
      assert.deepEqual(Object.keys(request.input.state).sort(), ["candidate", "reference"]);
      assert.deepEqual(Object.keys(request.input.questions), ["grounding", "subject", "style"]);
      for (const privateKey of ["expected", "partition", "labelProvenance"]) assert.ok(!JSON.stringify(request).includes(`"${privateKey}"`));
      const counterpart = rows.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant !== row.audit.variant);
      assert.equal(row.requirements.grounding, counterpart.requirements.grounding);
      assert.equal(row.requirements.style, counterpart.requirements.style);
      assert.equal(row.reference, counterpart.reference);
      assert.equal(row.candidate, counterpart.candidate);
      assert.notEqual(row.requirements.subject, counterpart.requirements.subject);
      const repeated = rows.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant === row.audit.variant && other.audit.repeat !== row.audit.repeat);
      assert.deepEqual(request, createJevRequest(repeated.candidate, repeated.requirements, { reference: repeated.reference }));
      const existing = controls.find((other) => other.id === row.audit.caseId);
      if (existing && row.audit.variant === "current") assert.deepEqual(request,
        createJevRequest(existing.candidate, existing.requirements, { reference: existing.reference }));
    }
  }
  assert.deepEqual([...new Set(holdout.filter((row) => row.expected === "pass").map((row) => row.audit.caseId))], ["room-tone-purpose", "names-purpose"]);
  assert.ok(holdout.every((row) => row.audit.partition === "human-holdout"));
  assert.ok(development.every((row) => !holdout.some((other) => row.candidate === other.candidate)));
});

// Narrow test doubles, not semantic judges. No expected labels enter either.
// The naive shortcut accepts topical vocabulary even when purpose is missing
// or advice is reversed/exaggerated. Freeze these trap predictions before live.
const predictedTraps = {
  development: ["caption-purpose-bad", "location-vague"],
  holdout: ["room-tone-vague", "room-tone-reversal", "names-vague", "names-exaggeration"],
  focus: ["room-tone-vague", "room-tone-reversal", "names-vague", "names-exaggeration"]
};
const acceptable = /^(Backup strategy for edits|How do we structure captions for clarity\?|Readable captions that preserve meaning|Keeping voices at an even volume|Filling edit gaps with room tone|Getting names right before recording)$/u;
function simulatedResponse(payload, naive) {
  const title = payload.input.state.candidate;
  const passes = naive ? /backup|caption|record|room tone|names|guest|volume/iu.test(title) : acceptable.test(title);
  const failureKey = /Removing dialogue noise|guarantees flawless/u.test(title) ? "grounding" : "subject";
  return { model: "jev-1.13.0", usage: { input_tokens: 0, output_tokens: 0 },
    answers: Object.fromEntries(Object.keys(payload.input.questions).map((key) => {
      const choice = passes || key !== failureKey ? "pass" : "fail";
      return [key, { type: "choice", choice, probabilities: { pass: choice === "pass" ? 1 : 0, fail: choice === "fail" ? 1 : 0, uncertain: 0 } }];
    })) };
}

test("simulated controls catch exactly the predicted topical-vocabulary false passes", async () => {
  for (const [partition, rows] of [["development", development], ["holdout", holdout], ["focus", focus], ["development", criteria], ["holdout", criteriaReused]]) {
    const faithful = await evaluateJevCases(rows, { policy: POLICY, call: async (payload) => simulatedResponse(payload, false) });
    const naive = await evaluateJevCases(rows, { policy: POLICY, call: async (payload) => simulatedResponse(payload, true) });
    const good = summarize(faithful, rows), bad = summarize(naive, rows);
    assert.deepEqual(good.controls, { correct: 24, falsePasses: 0, falseFailures: 0, review: 0, unevaluated: 0 });
    const variants = [...new Set(rows.map((row) => row.audit.variant))];
    const predictedIds = predictedTraps[partition].flatMap((id) => variants.flatMap((variant) => [1, 2].map((repeat) => `${id}-${variant}-${repeat}`))).sort();
    const verifyPrediction = (ids) => {
      assert.equal(bad.controls.falsePasses, ids.length);
      assert.deepEqual(bad.reviewQueue.map((row) => row.id).sort(), ids);
    };
    verifyPrediction(predictedIds);
    assert.throws(() => verifyPrediction(predictedIds.slice(1)), assert.AssertionError);
    assert.equal(bad.controls.falseFailures, 0);
    assert.equal(rubricMetrics(naive, rows).groups[variants[1]].falsePasses, predictedTraps[partition].length * 2);
    assert.equal(rubricMetrics(faithful, rows).repeatFlips.length, 0);
    const expectedPasses = rows.filter((row) => row.expected === "pass" && row.audit.variant === variants[0]).length;
    assert.equal(rubricMetrics(faithful, rows).groups[`${variants[0]}/expected-pass`].correct, expectedPasses);
  }
});

test("multi-question metrics keep failures, abstentions, and per-question repeat changes", async () => {
  const report = await evaluateJevCases(holdout, { policy: POLICY, call: async (payload) => simulatedResponse(payload, false) });
  report.cases[0].result.findings.subject = { choice: "pass", decision: "review" };
  assert.equal(rubricMetrics(report, holdout).groups.current.review, 1);
  assert.equal(rubricMetrics(report, holdout).repeatFlips.length, 1);
  assert.equal(rubricMetrics({ cases: [] }, holdout).groups.current.unevaluated, 12);
  // JSON object order is not a semantic change. Compare choices by question ID.
  for (const row of report.cases.filter((row) => row.id.endsWith("-2"))) {
    const entries = Object.entries(row.result.findings);
    row.result.findings = Object.fromEntries([...entries.slice(1), entries[0]]);
  }
  assert.equal(rubricMetrics(report, holdout).repeatFlips.length, 1);
});

test("title review modes remain offline by default and enforce fixture integrity", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-title-review-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const forbidden = () => { throw new Error("Unexpected capture/auth/network"); };
  for (const mode of ["titles", "holdout", "focus", "criteria", "criteria-reused"]) {
    assert.equal(parseOptions([`--review-${mode}`, "--live"]).native, false);
    assert.throws(() => parseOptions([`--review-${mode}`, "--native"]));
    assert.throws(() => parseOptions([`--review-${mode}`, "--review-rubric"]));
    assert.equal(await main([`--review-${mode}`], { root, captureNative: forbidden, credentials: forbidden, call: forbidden }), 0);
  }
  for (const run of await fs.readdir(path.join(root, "tmp/jev"))) {
    const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
    assert.equal(report.networkAttempts, 0);
    assert.equal(report.complete, false);
    assert.equal(report.rubricMetrics.groups.current.unevaluated, 12);
  }
  await fs.mkdir(path.dirname(path.join(root, TITLE_HOLDOUT_FIXTURE)), { recursive: true });
  await fs.writeFile(path.join(root, TITLE_HOLDOUT_FIXTURE), "unapproved data");
  await assert.rejects(loadRubricFixtures(root, "holdout"), /allowlist/);
});
