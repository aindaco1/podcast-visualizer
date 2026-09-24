#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { callCloudflareJev, createJevRequest, evaluateJevCases } from "@dustwave/test-core/jev";
import { sha256 } from "../src/canonical-json.js";
import { writeNewJson, writeNewFile } from "../src/files.js";
import { ROOT, FIXTURE, FIXTURE_SHA256, readBoundedFile, loadFixtures, localCorpus, nativeInput, nativeCorpus, validateAppleMetadata, semanticDecision, chapterRequirements, directTitleRequirements, methodTitleRequirements } from "./jev-corpus.mjs";
import { RUBRIC_FIXTURE, NAVIGATION_FIXTURE, TITLE_HOLDOUT_FIXTURE, TITLE_VALIDATION_FIXTURE, REVIEW_FIXTURES, loadRubricFixtures, rubricCorpus, rubricMetrics } from "./jev-rubric-review.mjs";

export const POLICY = Object.freeze({ minimumMargin: 0.10, models: ["jev-1.13.0"] });
const CHAPTER_RUBRICS = { current: chapterRequirements, direct: directTitleRequirements, method: methodTitleRequirements };
// Dated TypeSafe estimate (2026-09-22), NOT a provider billing cap.
const INPUT_USD_PER_MILLION = 0.042;
export const MAX_QUESTIONS = 80;
const SOURCE_PATHS = [FIXTURE, "scripts/jev-corpus.mjs", "scripts/jev-evaluation.mjs",
  RUBRIC_FIXTURE, NAVIGATION_FIXTURE, TITLE_HOLDOUT_FIXTURE, TITLE_VALIDATION_FIXTURE, "scripts/jev-rubric-review.mjs",
  "shared/dust-wave-platform/native/Sources/DustWaveAppleIntelligence/AppleGeneration.swift",
  "macos/Tests/PodcastVisualizerAppTests/JevCaptureTests.swift",
  "macos/Tests/PodcastVisualizerAppTests/AppleEvaluationSupport.swift",
  "macos/Sources/PodcastVisualizerApp/Services/ChapterAdviser.swift",
  "macos/Sources/PodcastVisualizerApp/Services/DialogueBoundaryAdviser.swift",
  "src/presentation-punctuation.js", "shared/dust-wave-platform/packages/timed-text/src/dialogue.js",
  "shared/dust-wave-platform/packages/timed-text/src/chapters.js",
  "shared/dust-wave-platform/packages/test-core/src/jev.js", "shared/dust-wave-platform/packages/worker-core/src/response-body.js"];
export const sourceHashes = async (extra = []) => Object.fromEntries(await Promise.all([...SOURCE_PATHS, ...extra].map(async (file) => [file, sha256(await readBoundedFile(ROOT, file))])));
export const RECOVERY = {
  preparation: "Jev could not finish saving evaluation evidence. Check the synthetic fixture allowlist, local dependencies and available storage, then retry in a new run. Existing evidence and all project data were preserved; retained steps record any requests that began.",
  native: "Native capture is incomplete. Check native.log for build failures and confirm Apple Intelligence is ready, then run with --native again. Existing evidence and all project data were preserved.",
  authentication: "Jev authentication is unavailable. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, then retry. The synthetic preview, existing evidence, and all project data were preserved; no evaluation requests were sent.",
  quality: "Quality checks need review. Inspect review.md and compare each flagged candidate with its synthetic source before changing product code or judge policy. Existing evidence and all project data were preserved.",
  remote: "Jev evaluation is incomplete. Check authentication, quota, or connectivity, then explicitly start a new run. Partial evidence and all project data were preserved; no retry was performed."
};

export function parseOptions(args) {
  const reviewFlags = Object.keys(REVIEW_FIXTURES).map((mode) => `--review-${mode}`);
  const chapterFlags = Object.keys(CHAPTER_RUBRICS).map((mode) => `--chapter-rubric=${mode}`);
  const selectedChapter = args.filter((arg) => chapterFlags.includes(arg));
  const allowed = new Set(["--live", "--native", "--dry-run", ...chapterFlags, ...reviewFlags]);
  const reviews = args.filter((arg) => reviewFlags.includes(arg));
  const reviewing = reviews.length > 0;
  if (new Set(args).size !== args.length || args.some((arg) => !allowed.has(arg) && !/^--max-estimated-usd=\d+(?:\.\d+)?$/u.test(arg)) ||
      args.filter((arg) => arg.startsWith("--max-estimated-usd=")).length > 1 || (args.includes("--live") && args.includes("--dry-run")) ||
      (reviewing && (args.includes("--native") || selectedChapter.length)) || selectedChapter.length > 1 || reviews.length > 1) throw new Error("Invalid Jev arguments");
  const maximum = Number(args.find((arg) => arg.startsWith("--max-estimated-usd="))?.split("=")[1] ?? 0.25);
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 1) throw new Error("Invalid estimate limit");
  return { live: args.includes("--live"), native: !reviewing && (args.includes("--live") || args.includes("--native")),
    review: reviews[0]?.slice("--review-".length) ?? null, chapterRubric: selectedChapter[0]?.split("=")[1] ?? "method", maximum };
}

export function reserveBudget(corpus, maximum) {
  const requests = corpus.filter((row) => !row.exactOnly).map((row) => createJevRequest(row.candidate, row.requirements, { reference: row.reference }));
  const questions = requests.reduce((sum, row) => sum + Object.keys(row.input.questions).length, 0);
  const reservedEstimateUsd = questions * 32_000 * INPUT_USD_PER_MILLION / 1_000_000;
  if (questions > MAX_QUESTIONS || reservedEstimateUsd > maximum) throw new Error("Evaluation exceeds budget");
  return { questions, reservedEstimateUsd };
}

export function credentials(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-fA-F0-9]{32}$/u.test(accountId || "") || typeof token !== "string" || !token.trim()) throw new Error(RECOVERY.authentication);
  return { accountId, token };
}

function verdict(row, result) {
  const semantic = semanticDecision(result);
  return { semantic, combined: row.deterministicFailures.length ? "fail" : row.exactOnly ? "pass" : semantic };
}

export function summarize(report, corpus, missing = []) {
  const controls = { correct: 0, falsePasses: 0, falseFailures: 0, review: 0, unevaluated: 0 };
  const exactControls = { correct: 0, falsePasses: 0, falseFailures: 0 };
  const candidates = { pass: 0, fail: 0, review: 0, unevaluated: 0 };
  const semanticCandidates = { ...candidates };
  const judgeExactDisagreements = [], reviewQueue = [];
  const evaluated = new Map(report.cases.map((row) => [row.id, row]));
  let deterministicFailures = 0, inputTokens = 0;
  for (const row of corpus) {
    const result = evaluated.get(row.id)?.result;
    inputTokens += result?.usage.input_tokens || 0;
    const { semantic, combined } = verdict(row, result);
    if (row.expected) {
      const counts = row.exactOnly ? exactControls : controls;
      const decision = row.exactOnly ? combined : semantic;
      if (["review", "unevaluated"].includes(decision)) counts[decision]++;
      else if (decision === row.expected) counts.correct++;
      else counts[decision === "pass" ? "falsePasses" : "falseFailures"]++;
      if (decision !== row.expected && decision !== "unevaluated") reviewQueue.push({ id: row.id, kind: row.kind,
        reason: decision === "review" ? "control-review" : "control-label-disagreement", expected: row.expected, decision });
    } else {
      semanticCandidates[semantic]++;
      candidates[combined]++;
      if (row.deterministicFailures.length) {
        deterministicFailures++;
        if (semantic === "pass") judgeExactDisagreements.push(row.id);
      }
      if (["fail", "review"].includes(combined)) reviewQueue.push({ id: row.id, kind: row.kind,
        reason: row.deterministicFailures.length ? "exact-failure" : `semantic-${combined}`,
        exactFailures: row.deterministicFailures,
        questions: Object.entries(result?.findings || {}).filter(([, finding]) => finding.decision !== "pass").map(([key]) => key) });
    }
  }
  return { controls, exactControls, candidates, semanticCandidates, deterministicFailures, judgeExactDisagreements, reviewQueue, missing, inputTokens,
    estimatedInferenceUsd: inputTokens * INPUT_USD_PER_MILLION / 1_000_000 };
}

export function exitCode(report, summary, { live }) {
  if (report.error || (live && (!report.complete || summary.missing.length))) return 2;
  if (summary.deterministicFailures || summary.exactControls?.falsePasses || summary.exactControls?.falseFailures || (live && (summary.controls.falsePasses || summary.controls.falseFailures ||
      summary.controls.review || summary.controls.unevaluated || summary.candidates.fail || summary.candidates.review || summary.candidates.unevaluated))) return 1;
  return 0;
}

export function reviewMarkdown(report, corpus, summary) {
  const lines = ["# Podcast Visualizer Jev development review", "",
    `Judge complete: ${report.complete}. Requests: ${report.networkAttempts}. Release accepted: false.`,
    "The 0.10 margin is provisional, not calibrated for Podcast Visualizer. Consult label provenance: engineering controls and small user-labeled probes do not establish general accuracy.",
    "A dry run is a request preview, not a semantic pass. Rendered pixels, speech accuracy, signed-app behavior and real podcast quality are outside this suite.", "",
    `Summary: ${JSON.stringify(summary)}`, "", ...(report.error ? [report.error, ""] : []), ...(report.guidance ? [report.guidance, ""] : [])];
  if (report.rubricMetrics) lines.push("## Frozen rubric comparison", "",
    "Two planned repeats per variant. Label provenance and partitions are retained in report.json and corpus.json.", "",
    `Metrics: ${JSON.stringify(report.rubricMetrics)}`, "");
  lines.push("## Review queue", "", ...(summary.reviewQueue.length
    ? summary.reviewQueue.map((row) => `- ${row.id}: ${row.reason}${row.questions?.length ? ` (${row.questions.join(", ")})` : ""}.`)
    : ["No evaluated findings need review. Unevaluated cases are not passes."]), "",
    "Candidate totals combine exact and semantic checks. Semantic-only totals remain separate; exact failures always win.", "");
  const evaluated = new Map(report.cases.map((row) => [row.id, row]));
  for (const row of corpus) {
    const decision = verdict(row, evaluated.get(row.id)?.result);
    lines.push(`## ${row.id}`, "", ...(row.expected ? [`Control label: ${row.expected}.`, ""] : []),
      `Combined result: ${decision.combined}.${row.exactOnly ? " Local exact check; no Jev request." : ` Semantic result: ${decision.semantic}.`}`, "",
      ...row.candidate.split("\n").map((line) => `> ${line}`), "");
    for (const failure of row.deterministicFailures) lines.push(`- Exact check failed: ${failure}`);
    for (const [key, finding] of Object.entries(evaluated.get(row.id)?.result?.findings || {})) {
      lines.push(`- ${finding.decision}: ${row.requirements[key]} Probabilities: ${JSON.stringify(finding.probabilities)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function createRun(root = ROOT) {
  let base = root;
  for (const segment of ["tmp", "jev"]) {
    base = path.join(base, segment);
    try { await fs.mkdir(base, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await fs.lstat(base);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe evidence directory");
  }
  return fs.mkdtemp(path.join(base, "run-"));
}

export async function captureNative(output, comparison = false) {
  const log = await fs.open(path.join(output, "native.log"), "wx", 0o600);
  try {
    // Credentials are not inherited by the local model/build process.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|^PODCAST_VISUALIZER_.*CAPTURE$/u.test(key)));
    env[comparison ? "PODCAST_VISUALIZER_APPLE_CAPTURE" : "PODCAST_VISUALIZER_JEV_CAPTURE"] = output;
    await new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/swift", ["test", "--package-path", "macos", "--build-system", "native", "--disable-automatic-resolution", "--filter", comparison ? "AppleFormattingComparisonTests" : "JevCaptureTests"], {
        cwd: ROOT, env, shell: false, stdio: ["ignore", log.fd, log.fd], timeout: 600_000
      });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(RECOVERY.native)));
    });
  } finally { await log.close(); }
}

export async function main(args = process.argv.slice(2), adapters = {}) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(`npm run test:jev -- [--native | ${Object.keys(REVIEW_FIXTURES).map((mode) => `--review-${mode}`).join(" | ")}] [--live | --dry-run] [--max-estimated-usd=0.25]\nDefault: offline synthetic preview with the method chapter rubric. --native: include local Apple inference. --live: native capture plus synthetic-only Jev. --chapter-rubric=current|direct|method: fixed rubric; current retains the historical baseline. Review modes: fixed synthetic comparisons, without Apple capture. No custom input or project paths.`);
    return 0;
  }
  const options = parseOptions(args);
  const fixtures = await loadFixtures(); // Fixed source hash checked before capture/auth.
  const reviewing = options.review !== null;
  const rubricFixtures = reviewing ? await loadRubricFixtures(ROOT, options.review) : null;
  const hashes = await sourceHashes();
  const output = await createRun(adapters.root || ROOT);
  console.log(`Synthetic evaluation evidence: ${output}`);
  const titleRequirements = CHAPTER_RUBRICS[options.chapterRubric];
  const corpus = rubricFixtures ? rubricCorpus(rubricFixtures) : localCorpus(fixtures, titleRequirements);
  let missing = options.native || reviewing ? [] : ["native-chapters-and-boundary-advice-not-run"];
  const input = JSON.stringify(nativeInput(fixtures));
  let nativeOutputSha256 = null;
  let appleModels = null;
  await writeNewFile(path.join(output, "native-input.json"), input);
  if (options.native) {
    let captured = false;
    try {
      await (adapters.captureNative || captureNative)(output);
      captured = true;
    } catch { missing = ["native-capture-failed"]; }
    if (captured) {
      if (sha256(await readBoundedFile(output, "native-input.json")) !== sha256(input)) throw new Error("Native input changed");
      const bytes = await readBoundedFile(output, "native-output.json");
      nativeOutputSha256 = sha256(bytes);
      const capture = JSON.parse(bytes);
      const native = nativeCorpus(fixtures, capture, titleRequirements);
      appleModels = validateAppleMetadata(JSON.parse(await readBoundedFile(output, "apple-models.json")));
      corpus.push(...native.cases);
      missing = native.missing;
    }
  }
  await loadFixtures(); // Reject edits/symlinks made during native generation.
  if (rubricFixtures) await loadRubricFixtures(ROOT, options.review);
  if (JSON.stringify(hashes) !== JSON.stringify(await sourceHashes())) throw new Error("Evaluation source changed during capture");
  const budget = reserveBudget(corpus, options.maximum);
  const metadata = { createdAt: new Date().toISOString(), fixtureSha256: FIXTURE_SHA256, corpusSha256: sha256(corpus),
    consumerSchemaVersion: "podcast-jev-evaluation-v2",
    mode: reviewing ? `${options.review}-review` : "full-suite",
    ...(!reviewing ? { chapterRubric: options.chapterRubric } : {}),
    ...(rubricFixtures ? { rubricFixtureSha256: REVIEW_FIXTURES[options.review][1], labelProvenance: rubricFixtures.labelProvenance } : {}),
    policyCalibrated: false, ...budget, inputUsdPerMillion: INPUT_USD_PER_MILLION,
    sourceHashes: hashes, candidateHashes: Object.fromEntries(corpus.map((row) => [row.id, sha256(row.candidate)])),
    nativeInputSha256: sha256(input), nativeOutputSha256, appleModels,
    host: { platform: os.platform(), architecture: os.arch(), kernel: os.release(), node: process.version } };
  await writeNewJson(path.join(output, "corpus.json"), corpus);
  const judgedCorpus = corpus.filter((row) => !row.exactOnly);
  let step = 0;
  const onProgress = (report) => writeNewJson(path.join(output, `step-${String(step++).padStart(3, "0")}.json`), report);
  let report = await evaluateJevCases(judgedCorpus, { policy: POLICY, maxQuestions: MAX_QUESTIONS });
  await writeNewJson(path.join(output, "preview.json"), { ...report, ...metadata });
  if (options.live && !missing.length) {
    let auth;
    try {
      auth = await (adapters.credentials || credentials)();
    } catch { report.error = RECOVERY.authentication; }
    if (auth) {
      let requestIndex = 0;
      let transportAttempts = 0, persistenceFailed = false;
      report = await evaluateJevCases(judgedCorpus, { policy: POLICY, maxQuestions: MAX_QUESTIONS, onProgress,
        call: async (payload) => {
          const index = requestIndex++;
          // Persist intent before transport, including a request that may fail or
          // be interrupted. A write failure must prevent the provider call.
          try {
            await writeNewJson(path.join(output, `request-${String(index).padStart(3, "0")}-pending.json`),
              { caseId: judgedCorpus[index].id, requestSha256: sha256(payload), startedAt: new Date().toISOString() });
          } catch { persistenceFailed = true; throw new Error(RECOVERY.preparation); }
          transportAttempts++;
          return (adapters.call || callCloudflareJev)(payload, auth);
        } });
      report.networkAttempts = transportAttempts;
      if (report.error) report.error = persistenceFailed ? RECOVERY.preparation : RECOVERY.remote;
    }
  }
  const summary = summarize(report, corpus, missing);
  if (rubricFixtures) report.rubricMetrics = rubricMetrics(report, corpus);
  if (options.native && missing.length && !report.error) report.error = RECOVERY.native;
  const code = exitCode(report, summary, options);
  if (code === 1) report.guidance = RECOVERY.quality;
  await writeNewJson(path.join(output, "report.json"), { ...report, ...metadata, summary });
  await writeNewFile(path.join(output, "review.md"), reviewMarkdown(report, corpus, summary));
  console.log(JSON.stringify({ output, complete: report.complete, networkAttempts: report.networkAttempts, ...summary }, null, 2));
  if (code) console.error(report.error || report.guidance);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error(RECOVERY.preparation);
    process.exitCode = 2;
  });
}
