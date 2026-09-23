#!/usr/bin/env node
// Local Apple-only experiment. This module never authenticates or calls Jev.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../src/canonical-json.js";
import { writeNewJson, writeNewFile } from "../src/files.js";
import { ROOT, readBoundedFile, validateAppleMetadata } from "./jev-corpus.mjs";
import { createRun, captureNative, sourceHashes } from "./jev-evaluation.mjs";

export const FIXTURE = "test/fixtures/jev/apple-formatting.json";
export const FIXTURE_SHA256 = "e9b52eb7947b7ef3c647cfca6e3322920aef6180ba785689ed22cb4768a3ed83";
const SOURCES = [FIXTURE, "scripts/apple-formatting-comparison.mjs", "macos/Tests/PodcastVisualizerAppTests/AppleFormattingComparisonTests.swift"];
export const RECOVERY = {
  capture: "Apple comparison is incomplete. Check native.log and Apple Intelligence readiness, then start a new run. Existing evidence, completed batch checkpoints and all project data were preserved.",
  findings: "Apple comparison found limitations. Inspect review.md and batch checkpoints before changing app policy. Existing evidence and all project data were preserved; no release was made.",
  preparation: "Apple comparison evidence could not be validated or saved. Check the synthetic allowlist, source changes and available storage, then start a new run. Existing evidence and all project data were preserved."
};

export async function loadComparisonFixture(root = ROOT) {
  const bytes = await readBoundedFile(root, FIXTURE);
  if (sha256(bytes) !== FIXTURE_SHA256) throw new Error("Apple synthetic allowlist mismatch");
  return JSON.parse(bytes);
}

export function comparisonInput(fixture) {
  const cue = (index, text, start, duration) => ({ id: `cue_${String(index + 1).padStart(6, "0")}`,
    textMarkdown: text, startsAtMs: start, endsAtMs: start + duration, speakerLabel: "speaker-01",
    speakerConfirmed: true, speakerConfidence: 1, speakerAmbiguous: false });
  // Two copies with unique IDs fill the historical 24-boundary batch. Twelve distinct labels.
  const pairs = [...fixture.pairs, ...fixture.pairs];
  return [
    { id: "short-pairs", cues: pairs.flatMap((pair, index) => [
      cue(index * 2, pair.left, index * 8_000, 2_000),
      cue(index * 2 + 1, pair.right, index * 8_000 + 2_100, 2_000)
    ]) },
    { id: "long-context", cues: Array.from({ length: 25 }, (_, index) =>
      cue(index, fixture.longParagraphs[index % fixture.longParagraphs.length], index * 30_100, 30_000)) }
  ];
}

export function comparisonSummary(fixture, rows) {
  const input = comparisonInput(fixture);
  if (!Array.isArray(rows) || rows.length !== 40) throw new Error("Incomplete Apple capture");
  const required = ["caseID", "useCase", "batchSize", "repetition", "batchIndex", "candidateIDs", "promptSHA256", "promptCharacters", "tokenCountError", "elapsedMilliseconds", "decisions", "error"];
  const counts = ["promptTokens", "instructionTokens", "schemaTokens", "inputTokens", "outputTokens"];
  const seen = new Set(), prompts = new Map(), groups = new Map();
  for (const row of rows) {
    if (!row || required.some((key) => !(key in row)) || Object.keys(row).some((key) => ![...required, ...counts].includes(key)) ||
        !["general", "contentTagging"].includes(row.useCase) || ![6, 24].includes(row.batchSize) || ![1, 2].includes(row.repetition) ||
        !Number.isInteger(row.batchIndex) || row.batchIndex < 0 || row.batchIndex >= 24 / row.batchSize ||
        !/^[a-f0-9]{64}$/u.test(row.promptSHA256) || !Number.isSafeInteger(row.promptCharacters) || row.promptCharacters <= 0 ||
        typeof row.tokenCountError !== "boolean" || !Number.isFinite(row.elapsedMilliseconds) || row.elapsedMilliseconds < 0 ||
        counts.some((key) => row[key] !== undefined && (!Number.isSafeInteger(row[key]) || row[key] < 0)) ||
        !["", "model_unavailable", "context_window_exceeded", "generation_failed"].includes(row.error) || !Array.isArray(row.decisions)) throw new Error("Invalid Apple batch");
    const item = input.find((item) => item.id === row.caseID);
    if (!item) throw new Error("Unknown Apple case");
    const allIDs = row.caseID === "short-pairs" ? item.cues.filter((_, index) => index % 2 === 0).map((cue) => cue.id) : item.cues.slice(0, -1).map((cue) => cue.id);
    const ids = allIDs.slice(row.batchIndex * row.batchSize, (row.batchIndex + 1) * row.batchSize);
    if (JSON.stringify(row.candidateIDs) !== JSON.stringify(ids)) throw new Error("Apple boundary mismatch");
    const groupID = `${row.caseID}/${row.useCase}/${row.batchSize}/${row.repetition}`, key = `${groupID}/${row.batchIndex}`;
    if (seen.has(key)) throw new Error("Duplicate Apple batch");
    seen.add(key);
    const promptKey = `${row.caseID}/${row.batchSize}/${row.batchIndex}`;
    if (prompts.has(promptKey) && prompts.get(promptKey) !== row.promptSHA256) throw new Error("Comparison prompts differ");
    prompts.set(promptKey, row.promptSHA256);
    if (!groups.has(groupID)) groups.set(groupID, { caseID: row.caseID, useCase: row.useCase, batchSize: row.batchSize,
      repetition: row.repetition, batches: 0, errors: [], missingDecisions: 0, invalidDecisions: 0,
      correct: 0, incorrect: 0, disagreements: [], elapsedMilliseconds: 0, maximumPromptTokens: null });
    const group = groups.get(groupID);
    group.batches++;
    group.elapsedMilliseconds += row.elapsedMilliseconds;
    if (row.promptTokens !== undefined) group.maximumPromptTokens = Math.max(group.maximumPromptTokens || 0, row.promptTokens);
    if (row.error) group.errors.push(row.error);
    if (row.error && row.decisions.length) throw new Error("Failed Apple batch contains decisions");
    const decisions = new Map();
    for (const decision of row.decisions) {
      if (!decision || JSON.stringify(Object.keys(decision).sort()) !== '["action","afterCueId"]' ||
          typeof decision.afterCueId !== "string" || typeof decision.action !== "string") throw new Error("Invalid Apple decision shape");
      if (!ids.includes(decision.afterCueId) || !["merge", "keep"].includes(decision.action) || decisions.has(decision.afterCueId)) {
        group.invalidDecisions++; continue;
      }
      decisions.set(decision.afterCueId, decision.action);
    }
    group.missingDecisions += ids.length - decisions.size;
    if (row.caseID === "short-pairs") for (const [id, action] of decisions) {
      const pair = fixture.pairs[allIDs.indexOf(id) % fixture.pairs.length];
      if (action === pair.expected) group.correct++;
      else { group.incorrect++; group.disagreements.push({ id, pair: pair.id, expected: pair.expected, actual: action }); }
    }
  }
  return [...groups.values()];
}

export function comparisonExitCode(groups) {
  if (!groups.length || groups.some((row) => row.errors.some((error) => error !== "context_window_exceeded"))) return 2;
  return groups.some((row) => row.errors.length || row.missingDecisions || row.invalidDecisions || row.incorrect) ? 1 : 0;
}

export function comparisonReview(report) {
  const lines = ["# Apple formatting comparison", "", "Local synthetic experiment; release accepted: false. No Jev requests.",
    "Two repetitions reverse model order. Both use cases receive identical prompt bytes, schema and greedy 1,024-token response limit. Batch sizes are 24 (historical baseline) and 6 (app default).",
    "Short-case labels cover 12 distinct engineering examples repeated to fill 24 boundaries; they are not independent quality validation. Long-context cases measure completeness only, because excerpts are truncated by the existing 320-character policy.",
    "Token counts and model metadata are omitted when unavailable; timing is descriptive and includes cold-model effects. Source hashes bind this run to its implementation.", "",
    `Apple metadata: ${JSON.stringify(report.appleModels)}`, "", ...(report.guidance ? [report.guidance, ""] : []),
    "| Case | Use case | Batch | Repeat | Correct / labeled | Missing | Invalid | Errors | Max prompt tokens | Seconds |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: |"];
  for (const row of report.groups) {
    lines.push(`| ${row.caseID} | ${row.useCase} | ${row.batchSize} | ${row.repetition} | ${row.caseID === "short-pairs" ? `${row.correct}/24` : "unscored"} | ${row.missingDecisions} | ${row.invalidDecisions} | ${row.errors.join(", ") || "none"} | ${row.maximumPromptTokens ?? "unavailable"} | ${(row.elapsedMilliseconds / 1000).toFixed(2)} |`);
  }
  for (const row of report.groups.filter((row) => row.disagreements.length)) lines.push("", `${row.caseID}/${row.useCase}/${row.batchSize}/repeat-${row.repetition}: ${JSON.stringify(row.disagreements)}`);
  return lines.join("\n");
}

export async function main(args = process.argv.slice(2), adapters = {}) {
  if (args.length === 1 && args[0] === "--help") { console.log("npm run test:apple:compare — local fixed synthetic comparison; no custom input or network evaluation."); return 0; }
  if (args.length) throw new Error("No Apple comparison arguments accepted");
  const fixture = await loadComparisonFixture(), hashes = await sourceHashes(SOURCES);
  const output = await createRun(adapters.root || ROOT);
  console.log(`Apple comparison evidence: ${output}`);
  const input = JSON.stringify(comparisonInput(fixture));
  await writeNewFile(path.join(output, "native-input.json"), input);
  const report = { releaseAccepted: false, complete: false, networkAttempts: 0, fixtureSha256: FIXTURE_SHA256,
    sourceHashes: hashes, nativeInputSha256: sha256(input), createdAt: new Date().toISOString(), appleModels: null, groups: [] };
  let captured = false;
  try { await (adapters.captureNative || captureNative)(output, true); captured = true; }
  catch { report.guidance = RECOVERY.capture; }
  if (captured) {
    await loadComparisonFixture();
    if (JSON.stringify(hashes) !== JSON.stringify(await sourceHashes(SOURCES)) || sha256(await readBoundedFile(output, "native-input.json")) !== sha256(input)) throw new Error("Apple sources changed during capture");
    const bytes = await readBoundedFile(output, "native-output.json");
    report.nativeOutputSha256 = sha256(bytes);
    report.appleModels = validateAppleMetadata(JSON.parse(await readBoundedFile(output, "apple-models.json")));
    report.groups = comparisonSummary(fixture, JSON.parse(bytes));
    report.complete = true;
  }
  const code = comparisonExitCode(report.groups);
  if (code) report.guidance = code === 2 ? RECOVERY.capture : RECOVERY.findings;
  await writeNewJson(path.join(output, "report.json"), report);
  await writeNewFile(path.join(output, "review.md"), comparisonReview(report));
  console.log(JSON.stringify({ output, complete: report.complete, exitCode: code, groups: report.groups }, null, 2));
  if (code) console.error(report.guidance);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => { process.exitCode = code; }).catch(() => {
  console.error(RECOVERY.preparation); process.exitCode = 2;
});
