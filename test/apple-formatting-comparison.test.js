import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../src/canonical-json.js";
import { writeNewJson } from "../src/files.js";
import { FIXTURE, RECOVERY, loadComparisonFixture, comparisonInput, comparisonSummary, comparisonExitCode, comparisonReview, main } from "../scripts/apple-formatting-comparison.mjs";

const fixture = await loadComparisonFixture();
const input = comparisonInput(fixture);
function capture() {
  return input.flatMap((item) => [24, 6].flatMap((batchSize) => [1, 2].flatMap((repetition) => ["contentTagging", "general"].flatMap((useCase) =>
    Array.from({ length: 24 / batchSize }, (_, batchIndex) => {
      const candidateIDs = Array.from({ length: batchSize }, (_, index) =>
        item.cues[(batchIndex * batchSize + index) * (item.id === "short-pairs" ? 2 : 1)].id);
      return { caseID: item.id, useCase, batchSize, repetition, batchIndex, candidateIDs,
        promptSHA256: sha256([item.id, batchSize, batchIndex]), promptCharacters: 300,
        elapsedMilliseconds: 10, tokenCountError: false, error: "",
        decisions: candidateIDs.map((afterCueId, index) => ({ afterCueId,
          action: item.id === "short-pairs" ? fixture.pairs[(batchIndex * batchSize + index) % fixture.pairs.length].expected : "keep" })) };
    })
  ))));
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-apple-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("Apple comparison fixes synthetic sources and exercises a full batch of long snippets", async (t) => {
  assert.equal(input[0].cues.length, 48);
  assert.equal(input[1].cues.length, 25);
  assert.ok(input[1].cues.every((cue) => cue.textMarkdown.length >= 320));
  assert.equal(fixture.pairs.filter((pair) => pair.expected === "merge").length, 6);
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "test/fixtures/jev"), { recursive: true });
  await fs.writeFile(path.join(root, FIXTURE), "private source");
  await assert.rejects(loadComparisonFixture(root), /allowlist/);
  await assert.rejects(main(["--input=/private"]), /arguments/);
});

test("comparison labels stay local and long snippets are unscored capacity probes", () => {
  const groups = comparisonSummary(fixture, capture());
  assert.equal(groups.length, 16);
  assert.equal(comparisonExitCode(groups), 0);
  assert.ok(groups.filter((row) => row.caseID === "short-pairs").every((row) => row.correct === 24));
  assert.ok(groups.filter((row) => row.caseID === "long-context").every((row) => row.correct === 0 && row.incorrect === 0));
  assert.ok(!JSON.stringify(input).includes("expected"));
  assert.equal(groups[0].maximumPromptTokens, null);
});

test("wrong, missing, duplicate and invented model decisions cannot silently pass", () => {
  for (const mutate of [
    (rows) => { rows[0].decisions[0].action = "keep"; },
    (rows) => { rows[0].decisions.pop(); },
    (rows) => { rows[0].decisions.push(rows[0].decisions[0]); },
    (rows) => { rows[0].decisions[0].afterCueId = "invented"; },
    (rows) => { rows[0].decisions[0].action = "rewrite"; }
  ]) { const rows = capture(); mutate(rows); assert.equal(comparisonExitCode(comparisonSummary(fixture, rows)), 1); }
});

test("overflow is retained as a finding, while missing models and generation failures are incomplete", () => {
  for (const error of ["context_window_exceeded", "model_unavailable", "generation_failed"]) {
    const rows = capture();
    rows[0].error = error; rows[0].decisions = [];
    const groups = comparisonSummary(fixture, rows);
    assert.equal(groups[0].missingDecisions, 24);
    assert.deepEqual(groups[0].errors, [error]);
    assert.equal(comparisonExitCode(groups), error === "context_window_exceeded" ? 1 : 2);
  }
  assert.equal(comparisonExitCode([]), 2);
});

test("comparison rejects incomplete matrices, unequal prompts, unsafe capture fields and invalid token counts", () => {
  for (const mutate of [
    (rows) => { rows.pop(); },
    (rows) => { rows[1] = rows[0]; },
    (rows) => { rows[0].privatePath = "/private"; },
    (rows) => { rows[0].promptSHA256 = "a".repeat(64); },
    (rows) => { rows[0].inputTokens = -1; },
    (rows) => { rows[0].candidateIDs[0] = "unknown"; },
    (rows) => { rows[0].decisions[0].secret = "private"; }
  ]) { const rows = capture(); mutate(rows); assert.throws(() => comparisonSummary(fixture, rows)); }
});

test("local runner retains model metadata, immutable evidence and descriptive quality findings", async (t) => {
  const root = await temporary(t);
  const models = { osVersion: "Synthetic OS", models: ["general", "contentTagging"].map((useCase) => ({
    useCase, available: true, displayName: "Synthetic model", contextSize: 4096, capabilities: ["guidedGeneration"]
  })) };
  const rows = capture(); rows[0].decisions[0].action = "keep";
  assert.equal(await main([], { root, captureNative: async (directory, comparison) => {
    assert.equal(comparison, true);
    await writeNewJson(path.join(directory, "native-output.json"), rows);
    await writeNewJson(path.join(directory, "apple-models.json"), models);
  } }), 1);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.releaseAccepted, false);
  assert.equal(report.complete, true);
  assert.deepEqual(report.appleModels, models);
  assert.equal(report.guidance, RECOVERY.findings);
  assert.match(comparisonReview(report), /unscored/);
  assert.match(comparisonReview(report), /continuation/);
});

test("capture failure preserves partial evidence and gives redacted actionable recovery", async (t) => {
  const root = await temporary(t);
  assert.equal(await main([], { root, captureNative: async (directory) => {
    await writeNewJson(path.join(directory, "batch-000.json"), { saved: true });
    throw new Error("private path");
  } }), 2);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const evidence = path.join(root, "tmp/jev", run);
  const report = await fs.readFile(path.join(evidence, "report.json"), "utf8");
  assert.match(report, /incomplete/);
  assert.ok(!report.includes("private path"));
  assert.equal(JSON.parse(await fs.readFile(path.join(evidence, "batch-000.json"))).saved, true);
  for (const message of Object.values(RECOVERY)) {
    assert.match(message, /preserved/);
    assert.match(message, /Check|Inspect/);
  }
});
