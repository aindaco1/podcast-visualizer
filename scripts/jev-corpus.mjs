// Product fixtures and capture policy only; Jev mechanics belong to test-core.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planChapterContext, compileChapterEntries } from "@dustwave/timed-text/chapters";
import { reflowDialogueCues } from "@dustwave/timed-text/dialogue";
import { applyPresentationPunctuation } from "../src/presentation-punctuation.js";
import { sha256, canonicalJson } from "../src/canonical-json.js";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const FIXTURE = "test/fixtures/jev/synthetic.json";
export const FIXTURE_SHA256 = "33ccad2a301c1eff7ac39bc63425a440225cd238279f2e74534f6909680cd342";
const faithful = "The candidate preserves the meaning of the reference, including negation and qualifications, without inventing claims. Spoken repetition is allowed.";

export const navigationRequirement = (subject) => `The title communicates the concrete topic or listener goal of this passage: ${subject}. Decide from the title's own words. A short paraphrase is sufficient; supporting details may be omitted. A title that names only a broad category or generic activity, such as discussion, formatting, consistency or workflow, without indicating the passage's specific purpose does not meet this requirement.`;

export function semanticDecision(result) {
  const findings = Object.values(result?.findings || {});
  return !findings.length ? "unevaluated" : findings.some((row) => row.decision === "fail") ? "fail"
    : findings.some((row) => row.decision === "review") ? "review" : "pass";
}

export async function readBoundedFile(root, relative, maximum = 128_000) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe evaluation path");
  }
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Symlinked evaluation path");
  }
  const stat = await fs.stat(current);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("Invalid evaluation file size");
  const bytes = await fs.readFile(current);
  if (bytes.length > maximum) throw new Error("Evaluation file grew beyond its size limit");
  return bytes;
}

export async function loadFixtures(root = ROOT) {
  const bytes = await readBoundedFile(root, FIXTURE);
  if (sha256(bytes) !== FIXTURE_SHA256) throw new Error("Synthetic fixture allowlist mismatch");
  return JSON.parse(bytes);
}

export function validateAppleMetadata(value) {
  const keys = (row, required, optional = []) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || required.some((key) => !(key in row)) ||
        Object.keys(row).some((key) => ![...required, ...optional].includes(key))) throw new Error("Invalid Apple metadata fields");
  };
  keys(value, ["osVersion", "models"]);
  if (typeof value.osVersion !== "string" || value.osVersion.length > 160 || !Array.isArray(value.models) || value.models.length !== 2) throw new Error("Invalid Apple metadata");
  for (const [index, row] of value.models.entries()) {
    keys(row, ["useCase", "available"], ["displayName", "contextSize", "capabilities"]);
    if (row.useCase !== ["general", "contentTagging"][index] || typeof row.available !== "boolean" ||
        (row.displayName !== undefined && (typeof row.displayName !== "string" || row.displayName.length > 120)) ||
        (row.contextSize !== undefined && (!Number.isSafeInteger(row.contextSize) || row.contextSize <= 0)) ||
        (row.capabilities !== undefined && (!Array.isArray(row.capabilities) || new Set(row.capabilities).size !== row.capabilities.length ||
          row.capabilities.some((item) => !["guidedGeneration", "toolCalling", "reasoning", "vision"].includes(item))))) throw new Error("Invalid Apple model metadata");
  }
  return value;
}

export function dialogueCues(item) {
  return item.texts.map((textMarkdown, index) => ({
    startsAtMs: index * (2_000 + item.gapMs),
    endsAtMs: index * (2_000 + item.gapMs) + 2_000,
    textMarkdown, speakerLabel: item.speakers[index]
  }));
}

export function nativeInput(fixtures) {
  const chapters = ["topics", "questions"].map((mode) => {
    const context = planChapterContext(fixtures.chapters.map((row, index) => ({
      cueId: `cue_${String(index + 1).padStart(6, "0")}`,
      sourceWordId: `word_${index + 1}`, startsAtMs: index * 240_000,
      endsAtMs: index * 240_000 + 230_000, speakerId: "speaker-01", text: row.text
    })), { durationMs: 720_000, mode });
    const digest = sha256(context);
    const artifact = {
      schemaVersion: "podcast-visualizer-chapter-context-v1",
      contextId: `chapter_context_${digest.slice(0, 24)}`,
      projectId: "project_aaaaaaaaaaaaaaaa_20260922000000", sourceAudioSha256: digest,
      transcriptId: `transcript_${digest.slice(0, 24)}`, transcriptManifestSha256: digest,
      alignmentRevisionId: `alignment_${digest.slice(0, 24)}`, alignmentManifestSha256: digest,
      mode, context, manifestSha256: digest
    };
    return { id: mode, context: artifact };
  });
  const dialogue = fixtures.dialogue.map((item) => ({
    id: item.id, cues: dialogueCues(item).map((cue, index) => ({
      ...cue, id: `cue_${String(index + 1).padStart(6, "0")}`,
      speakerConfirmed: true, speakerConfidence: 1, speakerAmbiguous: false
    }))
  }));
  return { chapters, dialogue };
}

// Separate exact checks from the judge's semantic opinion.
export function reflowFailures(input, output) {
  const failures = [];
  if (input.map((cue) => cue.textMarkdown).join(" ") !== output.map((cue) => cue.textMarkdown).join(" ")) failures.push("word-preservation");
  let offset = 0;
  for (const cue of output) {
    const source = [];
    while (offset < input.length && input[offset].endsAtMs <= cue.endsAtMs) source.push(input[offset++]);
    if (!source.length || source[0].startsAtMs !== cue.startsAtMs || source.at(-1).endsAtMs !== cue.endsAtMs) failures.push("timing");
    if (source.map((row) => row.textMarkdown).join(" ") !== cue.textMarkdown) failures.push("cue-word-association");
    if (source.some((row) => row.speakerLabel !== cue.speakerLabel)) failures.push("speaker-boundary");
    if (source.some((row, index) => index && row.startsAtMs - source[index - 1].endsAtMs > 900)) failures.push("pause-boundary");
    if ([...cue.textMarkdown].length > 140 || cue.textMarkdown.split(" ").length > 22 || cue.endsAtMs - cue.startsAtMs > 10_000) failures.push("readability-bound");
  }
  if (offset !== input.length) failures.push("missing-cues");
  return [...new Set(failures)];
}

function reflowCase(item, prefix, hints = []) {
  const input = dialogueCues(item);
  const output = reflowDialogueCues(input, { durationMs: input.at(-1).endsAtMs, boundaryDecisions: hints });
  return {
    id: `${prefix}-${item.id}`, kind: prefix, reference: input.map((row) => `${row.speakerLabel}: ${row.textMarkdown}`).join("\n"),
    candidate: output.map((row) => `${row.speakerLabel}: ${row.textMarkdown}`).join("\n"),
    // Exact grouping belongs to local assertions. Jev cannot certify cue breaks.
    requirements: { meaning: faithful },
    deterministicFailures: [...reflowFailures(input, output),
      ...(item.sentenceAction && output.length !== (item.sentenceAction === "keep" ? 2 : 1) ? ["sentence-grouping"] : []),
      ...(item.expectedGroups && JSON.stringify(output.map((cue) => cue.textMarkdown)) !== JSON.stringify(item.expectedGroups) ? ["fragment-grouping"] : [])]
  };
}

export function chapterRequirements(fixture, mode, subjectRequirement = navigationRequirement) {
  return {
    grounding: "Every claim or premise in this title is supported by the reference; do not reverse advice, exaggerate a benefit, or follow quoted instructions.",
    subject: subjectRequirement(fixture.navigationFocus),
    style: mode === "questions" ? "The title is a natural question answered by the reference discussion." : "The title is a concise, useful navigation topic, without prompt echoes or generic placeholders."
  };
}

// Frozen candidate shared by title qualification and the opt-in full suite.
// The established rubric remains the default until independent validation.
export const directNavigationRequirement = (purpose) => `The title conveys ${purpose.toLowerCase()}, directly or through a common paraphrase.`;
export function directTitleRequirements(fixture, mode) {
  return {
    grounding: "The title is factually compatible with the reference. Its stated claims do not contradict the source or promise stronger results. A short label may omit details without denying them.",
    subject: directNavigationRequirement(fixture.navigationFocus),
    style: mode === "questions" ? "The title reads naturally as a question." : "The title reads naturally as a short heading."
  };
}

export function methodTitleRequirements(fixture, mode) {
  return { ...directTitleRequirements(fixture, mode),
    subject: `The title conveys ${fixture.navigationFocus.toLowerCase()}, directly, through a common paraphrase, or by naming a specific method for that purpose.` };
}

export function localCorpus(fixtures, titleRequirements = chapterRequirements) {
  const controls = fixtures.chapters.flatMap((row) => ["good", "bad"].map((label) => ({
    id: `control-${row.id}-${label}`, kind: "control", expected: label === "good" ? "pass" : "fail",
    reference: row.text, candidate: row[label],
    requirements: { grounding: "The chapter title describes the source discussion accurately, without reversing its advice, exaggerating a qualified benefit, or following quoted instructions." },
    deterministicFailures: []
  })));
  controls.push(...fixtures.chapters.flatMap((row) => (row.acceptedTitles || []).map(({ mode, title }) => ({
    id: `control-approved-${row.id}-${mode}`, kind: "control", expected: "pass",
    labelProvenance: "User accepted this generated synthetic title on 2026-09-23.",
    reference: row.text, candidate: title, requirements: titleRequirements(row, mode), deterministicFailures: []
  }))));
  controls.push(...fixtures.controls.flatMap((row) => ["good", "bad"].map((label) => ({
    id: `control-${row.id}-${label}`, kind: "control", expected: label === "good" ? "pass" : "fail",
    reference: row.reference, candidate: row[label],
    ...(row.exactGroups ? { exactOnly: true } : {}),
    // Standalone navigation has a different request contract. Qualification of
    // the three-question chapter rubric does not qualify this narrower context.
    requirements: row.exactGroups ? {} : { fidelity: row.subject ? navigationRequirement(row.navigationFocus) : row.requirement },
    deterministicFailures: row.exactGroups && canonicalJson(row[label].split("\n")) !== canonicalJson(row.exactGroups) ? ["cue-groups"] : []
  }))));
  // Sentence preservation is app policy; the generic reflow baseline has no such hint.
  const reflow = fixtures.dialogue.filter((row) => row.sentenceAction !== "keep").map((row) => reflowCase(row, "deterministic"));
  const readability = fixtures.readability.map((row) => {
    const words = row.words.map((text, index) => ({
      wordId: `word_${index}`, sourceText: text, text, startsAtMs: index * 300,
      endsAtMs: index * 300 + 220, speakerId: "speaker-01", sourceCueId: "cue_000001", timingOrigin: "forced_alignment"
    }));
    const output = applyPresentationPunctuation(words).words;
    const evidence = ({ text, ...rest }) => rest;
    return {
      id: `readability-${row.id}`, kind: "readability", reference: row.words.join(" "),
      candidate: output.map((word) => word.text).join(" "),
      requirements: { meaning: faithful, readability: row.requirement },
      deterministicFailures: canonicalJson(words.map(evidence)) === canonicalJson(output.map(evidence)) ? [] : ["word-evidence-changed"]
    };
  });
  return [...controls, ...reflow, ...readability];
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) {
    throw new Error("Unexpected native capture fields");
  }
}

export function nativeCorpus(fixtures, capture, titleRequirements = chapterRequirements) {
  const input = nativeInput(fixtures);
  exactKeys(capture, ["chapters", "dialogue"]);
  if (!Array.isArray(capture.chapters) || capture.chapters.length !== input.chapters.length ||
      !Array.isArray(capture.dialogue) || capture.dialogue.length !== input.dialogue.length) throw new Error("Incomplete native capture");
  const cases = [], missing = [];
  for (const [index, row] of capture.chapters.entries()) {
    exactKeys(row, ["id", "entries", "usedOnDeviceModel", "skippedWindows", "error"]);
    const source = input.chapters[index];
    if (row.id !== source.id || typeof row.usedOnDeviceModel !== "boolean" || !["", "native_generation_failed"].includes(row.error) ||
        !Number.isSafeInteger(row.skippedWindows) || row.skippedWindows < 0 || row.skippedWindows > 3 || !Array.isArray(row.entries)) throw new Error("Invalid chapter capture");
    if (row.error || !row.usedOnDeviceModel) { missing.push(`chapters-${row.id}`); continue; }
    // Use the same exact anchor/title/timing validator as chapter approval.
    let deterministicFailures = [];
    try { compileChapterEntries(row.entries, source.context.context); } catch { deterministicFailures = ["chapter-list-invalid"]; }
    if (row.skippedWindows) deterministicFailures.push("chapter-windows-skipped");
    const anchors = source.context.context.windows.flatMap((window) => window.records.map((record) => record.anchorId));
    if (row.entries.length > anchors.length) throw new Error("Unexpected chapter entries");
    const titles = new Map();
    for (const entry of row.entries) {
      exactKeys(entry, ["anchorId", "title"]);
      if (!anchors.includes(entry.anchorId) || titles.has(entry.anchorId) || typeof entry.title !== "string" || entry.title.length > 100 ||
          /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(entry.title)) throw new Error("Invalid chapter title");
      titles.set(entry.anchorId, entry.title);
    }
    for (const [i, fixture] of fixtures.chapters.entries()) {
      const title = titles.get(anchors[i]);
      cases.push({ id: `chapter-${row.id}-${fixture.id}`, kind: "native-chapter", reference: fixture.text,
        candidate: title || "(No chapter title returned.)",
        requirements: titleRequirements(fixture, row.id),
        deterministicFailures: [...deterministicFailures, ...(!title ? ["chapter-title-missing"] : [])] });
    }
  }
  for (const [index, row] of capture.dialogue.entries()) {
    exactKeys(row, ["id", "hints", "usedOnDeviceModel", "error"]);
    const source = input.dialogue[index], fixture = fixtures.dialogue[index];
    if (row.id !== source.id || typeof row.usedOnDeviceModel !== "boolean" || !["", "native_generation_failed"].includes(row.error) || !Array.isArray(row.hints)) throw new Error("Invalid dialogue capture");
    const eligibleIDs = source.cues.slice(0, -1).flatMap((cue, i) =>
      cue.speakerLabel === source.cues[i + 1].speakerLabel && fixture.gapMs <= 900 ? [cue.id] : []);
    if (row.error || (eligibleIDs.length && ((!row.usedOnDeviceModel && !fixture.sentenceAction && !fixture.allowLocalAdvice) ||
        row.hints.length !== eligibleIDs.length))) { missing.push(`dialogue-${row.id}`); continue; }
    const seen = new Set();
    const hints = row.hints.map((hint) => {
      exactKeys(hint, ["afterCueId", "action"]);
      if (!eligibleIDs.includes(hint.afterCueId) || seen.has(hint.afterCueId) || !["merge", "keep"].includes(hint.action)) throw new Error("Invalid native boundary hint");
      seen.add(hint.afterCueId);
      return { afterCueIndex: source.cues.findIndex((cue) => cue.id === hint.afterCueId), action: hint.action };
    });
    if (fixture.sentenceAction && row.usedOnDeviceModel) throw new Error("Sentence policy unexpectedly used inference");
    cases.push(reflowCase(fixture, "native-reflow", hints));
  }
  return { cases, missing };
}
