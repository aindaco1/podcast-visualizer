// A fixed, synthetic-only comparison. Labels and partitions stay local.
import { ROOT, FIXTURE, FIXTURE_SHA256, readBoundedFile, navigationRequirement, chapterRequirements, directTitleRequirements, methodTitleRequirements, loadFixtures, semanticDecision } from "./jev-corpus.mjs";
import { sha256 } from "../src/canonical-json.js";

export const RUBRIC_FIXTURE = "test/fixtures/jev/rubric-review.json";
export const RUBRIC_SHA256 = "2733f39d64d1c998b65ce855fc56f29483cdfbbdd6e9dd0b6dc06e114b5a38db";
export const NAVIGATION_FIXTURE = "test/fixtures/jev/navigation-review.json";
export const NAVIGATION_SHA256 = "8611d47c20758f80ecbcab303980db38c3aa2ae3d3b24a2adc0531b382ee4b21";
export const TITLE_HOLDOUT_FIXTURE = "test/fixtures/jev/title-holdout.json";
export const TITLE_HOLDOUT_SHA256 = "f78018933661e6a89fee2b8204a2020aeddfc18685ff41c0b98572e89bd4482f";
export const TITLE_VALIDATION_FIXTURE = "test/fixtures/jev/title-validation.json";
export const TITLE_VALIDATION_SHA256 = "169e0c263451ffe94eebcf5ad1426378ab14a1805aaad532471e4a86ef7a9a2b";
const validationPartitions = { "validation-a": [0, 6], "validation-b": [6, 11], "validation-c": [11, 16] };
export const REVIEW_FIXTURES = {
  rubric: [RUBRIC_FIXTURE, RUBRIC_SHA256], navigation: [NAVIGATION_FIXTURE, NAVIGATION_SHA256],
  titles: [NAVIGATION_FIXTURE, NAVIGATION_SHA256], holdout: [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  focus: [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  criteria: [NAVIGATION_FIXTURE, NAVIGATION_SHA256], "criteria-reused": [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  "short-title": [NAVIGATION_FIXTURE, NAVIGATION_SHA256], "short-title-reused": [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  direct: [NAVIGATION_FIXTURE, NAVIGATION_SHA256], "direct-reused": [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  method: [NAVIGATION_FIXTURE, NAVIGATION_SHA256], "method-reused": [TITLE_HOLDOUT_FIXTURE, TITLE_HOLDOUT_SHA256],
  technique: [FIXTURE, FIXTURE_SHA256], clarity: [FIXTURE, FIXTURE_SHA256],
  ...Object.fromEntries(Object.keys(validationPartitions).map((mode) => [mode, [TITLE_VALIDATION_FIXTURE, TITLE_VALIDATION_SHA256]]))
};
// Frozen challenger, not the default rubric. Keep grounding/style identical.
export const purposeRequirement = (purpose) => `The title itself conveys this listener goal: ${purpose}. A concise paraphrase or familiar implication is sufficient; it need not name every supporting detail. Judge meaning rather than exact word overlap. Naming only a broad activity or category without its purpose is insufficient.`;
// Second-round hypothesis: make the pass/fail boundary explicit without
// changing the required purpose or the separate grounding/style questions.
export const explicitNavigationRequirement = (purpose) => `Judge this as a short chapter label. Pass when the title's own words express this purpose or an ordinary paraphrase: ${purpose}. Fail when it names only the general activity without that purpose. The source's particular method and examples may be omitted.`;
// Evaluate a navigation label as a label, not an exhaustive source summary.
// Frozen development challenger; the default is unchanged until qualification.
export const shortTitleRequirements = (fixture, mode) => ({
  ...directTitleRequirements(fixture, mode),
  subject: `The title gives a specific reason to visit this chapter about ${fixture.navigationFocus}. An ordinary paraphrase or a familiar implied benefit counts. A label naming only a broad activity, without the specific problem or purpose, fails.`
});
const legacySubject = (subject) => `The title identifies the main discussion topic: ${subject}. A concise umbrella phrase is sufficient; it need not restate supporting advice or every qualifier. Judge it as navigation, not as an exhaustive summary checklist.`;
const atomicNavigationRequirement = (purpose) => `The title tells a listener that this chapter is about ${purpose}. An equivalent everyday phrase or question counts. The title need not restate all details.`;
const naturalReadabilityRequirement = "Treat each numbered Cue as a separate caption display, not as a line-wrapped paragraph. The boundary between consecutive cues falls at a natural phrase break: a cue does not strand a determiner, conjunction, polite opener, or the final dependent word of the preceding phrase. Short complete replies and complete questions are acceptable. Judge readability of the shown boundaries, not whether concatenating their text makes a grammatical sentence.";
const cueCandidate = (text) => text.split("\n").map((line, index) => `Cue ${index + 1}: ${JSON.stringify(line)}`).join("\n");

export async function loadRubricFixtures(root = ROOT, review = "rubric") {
  if (review === "clarity") {
    const synthetic = await loadFixtures(root);
    const caption = synthetic.chapters.find((row) => row.id === "captions");
    const navigation = await loadRubricFixtures(root, "navigation");
    const technique = await loadRubricFixtures(root, "technique");
    return { review: "clarity", labelProvenance: "Development diagnosis using previously labeled synthetic titles. Clarity, technique and vague-caption labels are user judgments; purpose, unrelated and quoted-instruction labels are engineering controls. Not independent validation.",
      cases: [
        ...navigation.cases.filter((row) => ["clarity-paraphrase", "caption-purpose", "caption-vague", "caption-unrelated"].includes(row.id)).map((row) => ({
          ...row, mode: row.candidate.endsWith("?") ? "questions" : "topics"
        })),
        technique.cases[0],
        { id: "caption-quoted-instruction", candidate: caption.bad, expected: "fail", mode: "topics" }
      ].map((row) => ({ ...row, reference: caption.text, navigationFocus: caption.navigationFocus, kind: "title", partition: "development-clarity-diagnosis" })) };
  }
  if (review === "technique") {
    const fixtures = await loadFixtures(root);
    const caption = fixtures.chapters.find((row) => row.id === "captions");
    return { review: "method", labelProvenance: "User accepted this generated synthetic technique title on 2026-09-24. Development regression, not independent validation.",
      cases: [{ id: "caption-technique", candidate: "How to split captions at natural phrase boundaries",
        reference: caption.text, navigationFocus: caption.navigationFocus, mode: "topics", kind: "title", expected: "pass", partition: "development-user-technique" }] };
  }
  if (["method", "method-reused"].includes(review)) {
    const fixtures = await loadRubricFixtures(root, review === "method" ? "criteria" : "criteria-reused");
    return { ...fixtures, review: "method" };
  }
  if (["direct", "direct-reused"].includes(review)) {
    const fixtures = await loadRubricFixtures(root, review === "direct" ? "criteria" : "criteria-reused");
    return { ...fixtures, review: "direct" };
  }
  if (["short-title", "short-title-reused"].includes(review)) {
    const fixtures = await loadRubricFixtures(root, review === "short-title" ? "criteria" : "criteria-reused");
    return { ...fixtures, review: "short-title" };
  }
  if (["criteria", "criteria-reused"].includes(review)) {
    const fixtures = await loadRubricFixtures(root, review === "criteria" ? "titles" : "focus");
    return { ...fixtures, review: "title-criteria", cases: fixtures.cases.map((row) => ({ ...row,
      navigationFocus: row.revisedFocus ?? row.navigationFocus,
      partition: review === "criteria" ? "development-known" : "development-consumed-holdout"
    })) };
  }
  if (review === "focus") {
    const fixtures = await loadRubricFixtures(root, "holdout");
    return { ...fixtures, review: "title-focus", cases: fixtures.cases.map((row) => ({ ...row,
      partition: "development-consumed-holdout",
      revisedFocus: row.source === "names" ? "Pronouncing names correctly" : row.navigationFocus
    })) };
  }
  const [file, hash] = REVIEW_FIXTURES[review];
  const bytes = await readBoundedFile(root, file);
  if (sha256(bytes) !== hash) throw new Error("Rubric fixture allowlist mismatch");
  const fixtures = JSON.parse(bytes);
  if (review in validationPartitions) return { ...fixtures, cases: fixtures.cases.slice(...validationPartitions[review]).map((row) => ({
    ...row, reference: fixtures.sources[row.source].text, navigationFocus: fixtures.sources[row.source].navigationFocus,
    mode: "topics", kind: "title", partition: "human-validation"
  })) };
  if (review === "holdout") return { ...fixtures, cases: fixtures.cases.map((row) => ({
    ...row, reference: fixtures.sources[row.source].text, navigationFocus: fixtures.sources[row.source].navigationFocus,
    mode: "topics", kind: "title", partition: "human-holdout"
  })) };
  if (review !== "titles") return fixtures;
  const synthetic = await loadFixtures(root);
  const chapters = Object.fromEntries(synthetic.chapters.map((row) => [row.id, row]));
  return { review: "titles", labelProvenance: fixtures.labelProvenance, cases: [
    ...synthetic.chapters.flatMap((row) => (row.acceptedTitles || []).map(({ mode, title }) => ({
      id: `control-approved-${row.id}-${mode}`, reference: row.text, navigationFocus: row.navigationFocus,
      candidate: title, mode, expected: "pass"
    }))),
    ...["good", "bad"].map((label) => ({ id: `caption-purpose-${label}`, reference: chapters.captions.text,
      navigationFocus: chapters.captions.navigationFocus, candidate: synthetic.controls.find((row) => row.id === "caption-purpose")[label],
      expected: label === "good" ? "pass" : "fail", mode: "topics" })),
    ...fixtures.cases.filter((row) => ["levels-paraphrase", "location-vague"].includes(row.id)).map((row) => ({ ...row, mode: "topics" }))
  ].map((row) => ({ ...row, kind: "title", partition: "development" })) };
}

export function rubricCorpus(fixtures) {
  const navigation = fixtures.review === "navigation";
  const titleVariants = {
    titles: "purpose", "title-holdout": "purpose", "title-focus": "focus", "title-criteria": "explicit-purpose",
    "short-title": "short-title", direct: "direct", method: "method", clarity: "method"
  };
  const titles = fixtures.review in titleVariants;
  const variants = titles ? [fixtures.review === "clarity" ? "direct" : "current", titleVariants[fixtures.review]] : navigation ? ["current", "atomic"] : ["legacy", "explicit"];
  const titleRules = { direct: directTitleRequirements, method: methodTitleRequirements, "short-title": shortTitleRequirements };
  // Two planned repeats, reversed variant order on repeat two. Not retries.
  return [1, 2].flatMap((repeat) => (repeat === 1 ? variants : [...variants].reverse())
    .flatMap((variant) => fixtures.cases.map((row) => ({
      id: `${row.id}-${variant}-${repeat}`, kind: "control", expected: row.expected,
      audit: { caseId: row.id, partition: row.partition, domain: row.kind, variant, repeat },
      ...(variant === "atomic" ? {} : { reference: row.reference }),
      candidate: variant === "explicit" && row.kind === "cues" ? cueCandidate(row.candidate) : row.candidate,
      requirements: titleRules[variant] ? titleRules[variant](row, row.mode) : titles ? chapterRequirements(variant === "focus" ? { ...row, navigationFocus: row.revisedFocus } : row,
        row.mode, variant === "explicit-purpose" ? explicitNavigationRequirement : variant === "purpose" ? purposeRequirement : navigationRequirement) : { quality: navigation
        ? (variant === "atomic" ? atomicNavigationRequirement(row.navigationFocus) : navigationRequirement(row.navigationFocus)) : row.kind === "title"
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
    const result = results.get(row.id)?.result;
    const decision = semanticDecision(result);
    const { variant, partition, domain, caseId } = row.audit;
    for (const key of [variant, `${variant}/${partition}`, `${variant}/${domain}`, `${variant}/expected-${row.expected}`]) {
      const counts = groups[key] ??= { correct: 0, falsePasses: 0, falseFailures: 0, review: 0, unevaluated: 0 };
      if (["review", "unevaluated"].includes(decision)) counts[decision]++;
      else if (decision === row.expected) counts.correct++;
      else counts[decision === "pass" ? "falsePasses" : "falseFailures"]++;
    }
    const key = `${variant}/${caseId}`;
    const values = repeated.get(key) ?? [];
    values.push({ decision,
      choice: result ? Object.keys(row.requirements).map((key) => result.findings[key].choice).join(",") : "unevaluated",
      decisions: result ? Object.keys(row.requirements).map((key) => result.findings[key].decision).join(",") : "unevaluated" });
    repeated.set(key, values);
  }
  return { groups, repeatFlips: [...repeated].flatMap(([id, values]) =>
    values.some((row) => row.decision === "unevaluated") ? []
      : ["decision", "choice", "decisions"].some((key) => new Set(values.map((row) => row[key])).size > 1) ? [{ id, values }] : []) };
}
