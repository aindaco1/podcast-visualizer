import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJevRequest, evaluateJevCases } from "@dustwave/test-core/jev";
import { chapterRequirements, methodTitleRequirements } from "../scripts/jev-corpus.mjs";
import { loadRubricFixtures, rubricCorpus, rubricMetrics, TITLE_VALIDATION_FIXTURE } from "../scripts/jev-rubric-review.mjs";
import { main, POLICY, reserveBudget, summarize } from "../scripts/jev-evaluation.mjs";

const modes = ["validation-a", "validation-b", "validation-c"];
const fixtures = await Promise.all(modes.map((mode) => loadRubricFixtures(undefined, mode)));
const partitions = fixtures.map(rubricCorpus);
const corpus = partitions.flat();

test("reserved validation preserves the user's clarified labels and the frozen rubric", () => {
  const rows = fixtures.flatMap((fixture) => fixture.cases);
  assert.deepEqual(rows.filter((row) => row.expected === "pass").map((row) => row.number), [1, 2, 6, 7, 8, 9, 11, 14, 15]);
  assert.deepEqual(rows.map((row) => row.number), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(fixtures[0].initialAcceptedNumbers, [1, 2, 5, 6, 7, 8, 9, 11, 14, 15, 16]);
  assert.deepEqual(fixtures[0].clarifiedRejectedNumbers, [5, 16]);
  assert.equal(corpus.length, 64);
  assert.equal(new Set(corpus.map((row) => row.id)).size, 64);
  assert.deepEqual(partitions.map((rows) => reserveBudget(rows, 0.15).questions), [72, 60, 60]);
  for (const row of corpus) {
    const fixture = rows.find((item) => item.id === row.audit.caseId);
    assert.equal(row.audit.partition, "human-validation");
    assert.deepEqual(row.requirements, (row.audit.variant === "current" ? chapterRequirements : methodTitleRequirements)(fixture, "topics"));
    const request = createJevRequest(row.candidate, row.requirements, { reference: row.reference });
    assert.deepEqual(request.input.state, { reference: row.reference, candidate: row.candidate });
    for (const key of ["expected", "number", "source", "labelProvenance", "initialAcceptedNumbers", "clarifiedRejectedNumbers", "partition"]) {
      assert.ok(!JSON.stringify(request).includes(`"${key}"`));
    }
    const repeat = corpus.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant === row.audit.variant && other.audit.repeat !== row.audit.repeat);
    assert.deepEqual(request, createJevRequest(repeat.candidate, repeat.requirements, { reference: repeat.reference }));
  }
});

// Fixed test doubles validate the scoring path, not the semantic judgment.
const approved = /^(Keeping loud voices from distorting|Preventing clipping during recording|Tighter pacing that preserves thoughtful pauses|Timeline cleanup|Shortening pauses without losing meaning|Softening harsh P and B sounds|Reducing plosive sounds through microphone placement|Lining up separate recordings|Aligning tracks with a clap)$/u;
function simulated(payload, naive) {
  const title = payload.input.state.candidate;
  const pass = naive ? /voices|clipping|input|audio|pause|pacing|timeline|plosive|microphone|breath|session|record|tracks|clap|sounds/iu.test(title) : approved.test(title);
  const failureKey = /Repairing|every pause|all breath|throughout/u.test(title) ? "grounding" : "subject";
  return { model: "jev-1.13.0", usage: { input_tokens: 0, output_tokens: 0 },
    answers: Object.fromEntries(Object.keys(payload.input.questions).map((key) => {
      const choice = pass || key !== failureKey ? "pass" : "fail";
      return [key, { type: "choice", choice, probabilities: { pass: choice === "pass" ? 1 : 0, fail: choice === "fail" ? 1 : 0, uncertain: 0 } }];
    })) };
}

test("offline validation detects the exact twenty-eight predicted false approvals", async () => {
  const faithful = { cases: [] }, naive = { cases: [] };
  for (const rows of partitions) {
    faithful.cases.push(...(await evaluateJevCases(rows, { policy: POLICY, call: async (payload) => simulated(payload, false) })).cases);
    naive.cases.push(...(await evaluateJevCases(rows, { policy: POLICY, call: async (payload) => simulated(payload, true) })).cases);
  }
  assert.deepEqual(summarize(faithful, corpus).controls, { correct: 64, falsePasses: 0, falseFailures: 0, review: 0, unevaluated: 0 });
  const bad = summarize(naive, corpus);
  const predicted = [3, 4, 5, 10, 12, 13, 16].flatMap((n) => ["current", "method"].flatMap((variant) => [1, 2].map((repeat) => `validation-${String(n).padStart(2, "0")}-${variant}-${repeat}`))).sort();
  const verify = (ids) => { assert.equal(bad.controls.falsePasses, ids.length); assert.deepEqual(bad.reviewQueue.map((row) => row.id).sort(), ids); };
  verify(predicted);
  assert.throws(() => verify(predicted.slice(1)), assert.AssertionError);
  assert.equal(rubricMetrics(naive, corpus).groups.method.falsePasses, 14);
  assert.equal(rubricMetrics(faithful, corpus).repeatFlips.length, 0);
});

test("validation previews stay offline and the new fixture is hash-allowlisted", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-title-validation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const forbidden = () => { throw new Error("Unexpected capture/auth/network"); };
  for (const mode of modes) assert.equal(await main([`--review-${mode}`], { root, captureNative: forbidden, credentials: forbidden, call: forbidden }), 0);
  for (const run of await fs.readdir(path.join(root, "tmp/jev"))) {
    const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
    assert.equal(report.networkAttempts, 0);
    assert.equal(report.complete, false);
    assert.match(report.sourceHashes[TITLE_VALIDATION_FIXTURE], /^[a-f0-9]{64}$/u);
  }
  await fs.mkdir(path.dirname(path.join(root, TITLE_VALIDATION_FIXTURE)), { recursive: true });
  await fs.writeFile(path.join(root, TITLE_VALIDATION_FIXTURE), "unapproved data");
  await assert.rejects(loadRubricFixtures(root, "validation-a"), /allowlist/);
});
