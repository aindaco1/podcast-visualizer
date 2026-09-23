import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJevRequest } from "@dustwave/test-core/jev";
import { loadRubricFixtures, rubricCorpus, rubricMetrics, RUBRIC_FIXTURE } from "../scripts/jev-rubric-review.mjs";
import { main, parseOptions, reserveBudget } from "../scripts/jev-evaluation.mjs";

const fixtures = await loadRubricFixtures();
const corpus = rubricCorpus(fixtures);

test("rubric comparison freezes two variants, reversed repeats and label provenance outside requests", () => {
  assert.equal(corpus.length, 64);
  assert.equal(new Set(corpus.map((row) => row.id)).size, 64);
  assert.equal(reserveBudget(corpus, 0.15).questions, 64);
  assert.deepEqual([0, 16, 32, 48].map((index) => corpus[index].audit.variant), ["legacy", "explicit", "explicit", "legacy"]);
  for (const row of corpus) {
    const request = createJevRequest(row.candidate, row.requirements, { reference: row.reference });
    assert.deepEqual(Object.keys(request.input.state).sort(), ["candidate", "reference"]);
    assert.ok(!JSON.stringify(request).includes('"expected"'));
    assert.ok(!JSON.stringify(request).includes('"partition"'));
    const repeated = corpus.find((other) => other.audit.caseId === row.audit.caseId && other.audit.variant === row.audit.variant && other.audit.repeat !== row.audit.repeat);
    assert.deepEqual(createJevRequest(repeated.candidate, repeated.requirements, { reference: repeated.reference }), request);
  }
});

test("rubric metrics retain false passes, abstentions, domain splits and repeat flips", () => {
  const report = { cases: corpus.map((row) => ({ id: row.id, result: { findings: { quality: {
    choice: row.expected, decision: row.expected
  } } } })) };
  report.cases[1].result.findings.quality = { choice: "pass", decision: "pass" };
  report.cases[2].result.findings.quality = { choice: "pass", decision: "review" };
  const metrics = rubricMetrics(report, corpus);
  assert.equal(metrics.groups.legacy.falsePasses, 1);
  assert.equal(metrics.groups.legacy.review, 1);
  assert.equal(metrics.groups.explicit.correct, 32);
  assert.equal(metrics.groups["legacy/cues"].falsePasses, 1);
  assert.equal(metrics.repeatFlips.length, 2);
  assert.equal(rubricMetrics({ cases: [] }, corpus).groups.legacy.unevaluated, 32);
});

test("rubric preview stays offline, skips native generation, and rejects altered fixture bytes", async (t) => {
  assert.equal(parseOptions(["--review-rubric", "--live"]).native, false);
  assert.throws(() => parseOptions(["--review-rubric", "--native"]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-rubric-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const forbidden = () => { throw new Error("Unexpected capture/auth/network"); };
  assert.equal(await main(["--review-rubric"], { root, captureNative: forbidden, credentials: forbidden, call: forbidden }), 0);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.mode, "rubric-review");
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.complete, false);
  assert.equal(report.rubricMetrics.groups.explicit.unevaluated, 32);
  await fs.mkdir(path.dirname(path.join(root, RUBRIC_FIXTURE)), { recursive: true });
  await fs.writeFile(path.join(root, RUBRIC_FIXTURE), "unapproved data");
  await assert.rejects(loadRubricFixtures(root), /allowlist/);
});
