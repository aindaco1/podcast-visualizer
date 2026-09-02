import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileRecognitionConfidence,
  RECOGNITION_CONFIDENCE_POLICY_VERSION,
  RECOGNITION_CONFIDENCE_SCHEMA
} from "@dustwave/timed-text/confidence";

import { loadReviewDraft, loadWorkingReview } from "../src/review-workspace.js";
import { resolveActiveTranscript } from "../src/review-revisions.js";
import { loadSpeechAnalysis } from "../src/speech.js";

const REPORT_SCHEMA = "podcast-visualizer-confidence-calibration-v1";
const TIERS = ["ultraLow", "low", "medium", "high", "unavailable"];
const SPOKEN_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function spokenWords(text) {
  return (text.normalize("NFKC").toLocaleLowerCase("en-US").match(SPOKEN_WORD) ?? [])
    .map((word) => word.replaceAll("’", "'"));
}

function sameWords(left, right) {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

function roundedRate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function emptyTier() {
  return { cues: 0, correctedCues: 0, correctionRate: null };
}

function lengthBand(wordCount) {
  if (wordCount <= 5) return "short";
  if (wordCount <= 12) return "medium";
  return "long";
}

export function summarizeConfidenceCalibration(samples) {
  if (!Array.isArray(samples) || samples.length < 1) {
    throw new TypeError("At least one confidence calibration sample is required");
  }
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, emptyTier()]));
  const lengthBands = Object.fromEntries(["short", "medium", "long"].map((band) => [band, emptyTier()]));
  let cueCount = 0;
  let correctedCueCount = 0;

  for (const sample of samples) {
    if (!sample || !Array.isArray(sample.draftCues) || !Array.isArray(sample.reviewedCues)
        || !Array.isArray(sample.confidence?.cues)
        || sample.draftCues.length !== sample.reviewedCues.length
        || sample.draftCues.length !== sample.confidence.cues.length) {
      throw new TypeError("Confidence calibration sample is invalid");
    }
    for (let index = 0; index < sample.draftCues.length; index += 1) {
      const draft = sample.draftCues[index];
      const reviewed = sample.reviewedCues[index];
      const confidence = sample.confidence.cues[index];
      if (draft.id !== reviewed.id || draft.id !== confidence.cueId
          || draft.startsAtMs !== reviewed.startsAtMs || draft.endsAtMs !== reviewed.endsAtMs
          || !TIERS.includes(confidence.tier)) {
        throw new TypeError("Calibration requires unchanged cue identities and timing");
      }
      const draftWords = spokenWords(draft.textMarkdown);
      const reviewedWords = spokenWords(reviewed.textMarkdown);
      const corrected = !sameWords(draftWords, reviewedWords);
      const band = lengthBand(draftWords.length);
      cueCount += 1;
      tiers[confidence.tier].cues += 1;
      lengthBands[band].cues += 1;
      if (corrected) {
        correctedCueCount += 1;
        tiers[confidence.tier].correctedCues += 1;
        lengthBands[band].correctedCues += 1;
      }
    }
  }

  for (const group of [...Object.values(tiers), ...Object.values(lengthBands)]) {
    group.correctionRate = roundedRate(group.correctedCues, group.cues);
  }
  const priorityCues = tiers.ultraLow.cues + tiers.low.cues;
  const priorityCorrections = tiers.ultraLow.correctedCues + tiers.low.correctedCues;
  const mediumHighCorrections = tiers.medium.correctedCues + tiers.high.correctedCues;
  return {
    schemaVersion: REPORT_SCHEMA,
    confidenceSchemaVersion: RECOGNITION_CONFIDENCE_SCHEMA,
    policyVersion: RECOGNITION_CONFIDENCE_POLICY_VERSION,
    projectsEvaluated: samples.length,
    cueCount,
    correctedCueCount,
    tiers,
    priorityQueue: {
      tiers: ["ultraLow", "low"],
      cues: priorityCues,
      cueShare: roundedRate(priorityCues, cueCount),
      correctedCues: priorityCorrections,
      correctionRecall: roundedRate(priorityCorrections, correctedCueCount)
    },
    mediumHighFalseNegatives: {
      correctedCues: mediumHighCorrections,
      shareOfCorrections: roundedRate(mediumHighCorrections, correctedCueCount)
    },
    lengthBands
  };
}

async function projectSample(projectRoot) {
  const draft = await loadReviewDraft(projectRoot);
  const active = await resolveActiveTranscript({
    projectRoot,
    sourceAudioSha256: draft.sourceAudioSha256,
    required: false
  });
  const working = await loadWorkingReview(projectRoot, draft, active?.transcript ?? null);
  const reviewedCues = working?.cues ?? active?.transcript.cues;
  if (!reviewedCues) {
    throw new Error("Calibration requires a valid saved working review or approved transcript");
  }
  const preparedIdentity = {
    prepare: {
      analysis: {
        sha256: draft.sourceAudioSha256,
        durationMs: draft.durationMs
      }
    }
  };
  const speech = await loadSpeechAnalysis(projectRoot, preparedIdentity);
  const tokens = speech.transcript.tokens.map((token) => {
    const startsAtMs = Math.max(0, Math.floor(token.startsAtSeconds * 1_000));
    return {
      text: token.text,
      startsAtMs,
      endsAtMs: Math.max(startsAtMs + 1, Math.ceil(token.endsAtSeconds * 1_000)),
      confidence: token.confidence
    };
  });
  return {
    draftCues: draft.cues,
    reviewedCues,
    confidence: compileRecognitionConfidence({ cues: reviewedCues, tokens })
  };
}

function projectArguments(arguments_) {
  const projects = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--project" || !arguments_[index + 1]) {
      throw new Error("Usage: node scripts/calibrate-transcript-confidence.mjs --project /absolute/project [--project /absolute/project]");
    }
    const projectRoot = arguments_[index + 1];
    if (!path.isAbsolute(projectRoot)) throw new Error("Calibration project paths must be absolute");
    projects.push(projectRoot);
    index += 1;
  }
  if (projects.length < 1) throw new Error("At least one --project is required");
  return projects;
}

async function main() {
  const projects = projectArguments(process.argv.slice(2));
  const samples = [];
  for (const projectRoot of projects) samples.push(await projectSample(projectRoot));
  process.stdout.write(`${JSON.stringify(summarizeConfidenceCalibration(samples), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`Confidence calibration failed: ${error.message}\nPrivate project data was preserved.\n`);
    process.exitCode = 1;
  });
}
