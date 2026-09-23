// A fixed, synthetic-only comparison. Labels and partitions stay local.
import { ROOT, readBoundedFile, cueCandidate, naturalReadabilityRequirement, navigationRequirement } from "./jev-corpus.mjs";
import { sha256 } from "../src/canonical-json.js";

export const RUBRIC_FIXTURE = "test/fixtures/jev/rubric-review.json";
export const RUBRIC_SHA256 = "2733f39d64d1c998b65ce855fc56f29483cdfbbdd6e9dd0b6dc06e114b5a38db";
const legacySubject = (subject) => `The title identifies the main discussion topic: ${subject}. A concise umbrella phrase is sufficient; it need not restate supporting advice or every qualifier. Judge it as navigation, not as an exhaustive summary checklist.`;

export async function loadRubricFixtures(root = ROOT) {
  const bytes = await readBoundedFile(root, RUBRIC_FIXTURE);
  if (sha256(bytes) !== RUBRIC_SHA256) throw new Error("Rubric fixture allowlist mismatch");
  return JSON.parse(bytes);
}

export function rubricCorpus(fixtures) {
  // Two planned repeats, reversed variant order on repeat two. Not retries.
  return [1, 2].flatMap((repeat) => (repeat === 1 ? ["legacy", "explicit"] : ["explicit", "legacy"])
    .flatMap((variant) => fixtures.cases.map((row) => ({
      id: `${row.id}-${variant}-${repeat}`, kind: "control", expected: row.expected,
      audit: { caseId: row.id, partition: row.partition, domain: row.kind, variant, repeat },
      reference: row.reference,
      candidate: variant === "explicit" && row.kind === "cues" ? cueCandidate(row.candidate) : row.candidate,
      requirements: { quality: row.kind === "title"
        ? (variant === "explicit" ? navigationRequirement(row.subject) : legacySubject(row.subject))
        : (variant === "explicit" ? naturalReadabilityRequirement : row.legacyRequirement) },
      deterministicFailures: []
    }))));
}

export function rubricMetrics(report, corpus) {
  const results = new Map(report.cases.map((row) => [row.id, row]));
  const groups = {};
  const repeated = new Map();
  for (const row of corpus) {
    const finding = results.get(row.id)?.result?.findings.quality;
    const decision = finding?.decision ?? "unevaluated";
    const { variant, partition, domain, caseId } = row.audit;
    for (const key of [variant, `${variant}/${partition}`, `${variant}/${domain}`]) {
      const counts = groups[key] ??= { correct: 0, falsePasses: 0, falseFailures: 0, review: 0, unevaluated: 0 };
      if (["review", "unevaluated"].includes(decision)) counts[decision]++;
      else if (decision === row.expected) counts.correct++;
      else counts[decision === "pass" ? "falsePasses" : "falseFailures"]++;
    }
    const key = `${variant}/${caseId}`;
    const values = repeated.get(key) ?? [];
    values.push({ decision, choice: finding?.choice ?? "unevaluated" });
    repeated.set(key, values);
  }
  return { groups, repeatFlips: [...repeated].flatMap(([id, values]) =>
    values.some((row) => row.decision === "unevaluated") ? []
      : new Set(values.map((row) => row.decision)).size > 1 || new Set(values.map((row) => row.choice)).size > 1 ? [{ id, values }] : []) };
}
