import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewJson } from "./files.js";
import { validateBundledDiarizationModel } from "./models.js";
import { loadPreparedMedia } from "./prepare.js";
import { runProcess } from "./process.js";
import { buildReviewDraft, validateReviewDraft } from "./review.js";
import {
  BUNDLED_MODELS_ROOT, defaultToolPath, validateBundledSpeechRuntime
} from "./runtime.js";
import { buildSpeakerTurns, validateSpeakerTurns } from "./speaker-turns.js";

export const SPEECH_ANALYSIS_SCHEMA = "podcast-visualizer-speech-v1";
const MAXIMUM_ITEMS = 500_000;
const DIGEST = /^[a-f0-9]{64}$/;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new CliError(`${label} is invalid`);
  return value;
}

function validateEngine(value, label) {
  const keys = ["name", "version", "model", "modelVersion", "settingsVersion"];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new CliError(`${label} engine is invalid`);
  }
  for (const key of keys) {
    if (typeof value[key] !== "string" || !value[key] || value[key].length > 180) {
      throw new CliError(`${label} engine ${key} is invalid`);
    }
  }
  return value;
}

export function validateSpeechAnalysis(value, prepared) {
  const keys = new Set([
    "schemaVersion", "sourceAudioSha256", "transcriptionEngine", "diarizationEngine",
    "transcript", "speakerTurns"
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.has(key))
      || value.schemaVersion !== SPEECH_ANALYSIS_SCHEMA
      || !DIGEST.test(value.sourceAudioSha256)
      || value.sourceAudioSha256 !== prepared.prepare.analysis.sha256) {
    throw new CliError("speech analysis identity is invalid");
  }
  validateEngine(value.transcriptionEngine, "transcription");
  validateEngine(value.diarizationEngine, "diarization");
  const transcript = value.transcript;
  const transcriptKeys = new Set(["text", "durationSeconds", "confidence", "tokens", "words"]);
  if (!transcript || typeof transcript !== "object" || Array.isArray(transcript)
      || Object.keys(transcript).some((key) => !transcriptKeys.has(key))
      || typeof transcript.text !== "string" || transcript.text.length > 10_000_000
      || !Number.isFinite(transcript.confidence) || transcript.confidence < 0 || transcript.confidence > 1
      || !Number.isFinite(transcript.durationSeconds) || transcript.durationSeconds <= 0
      || Math.abs(transcript.durationSeconds * 1000 - prepared.prepare.analysis.durationMs) > 250
      || !Array.isArray(transcript.tokens) || transcript.tokens.length > MAXIMUM_ITEMS
      || !Array.isArray(transcript.words) || transcript.words.length < 1 || transcript.words.length > MAXIMUM_ITEMS) {
    throw new CliError("speech transcript is invalid");
  }
  for (const [index, token] of transcript.tokens.entries()) {
    const tokenKeys = new Set(["text", "tokenId", "startsAtSeconds", "endsAtSeconds", "confidence"]);
    if (!token || typeof token !== "object" || Array.isArray(token)
        || Object.keys(token).some((key) => !tokenKeys.has(key))
        || typeof token.text !== "string" || token.text.length > 240
        || !Number.isSafeInteger(token.tokenId)
        || !Number.isFinite(token.startsAtSeconds) || token.startsAtSeconds < 0
        || !Number.isFinite(token.endsAtSeconds) || token.endsAtSeconds < token.startsAtSeconds
        || !Number.isFinite(token.confidence) || token.confidence < 0 || token.confidence > 1) {
      throw new CliError(`speech token ${index + 1} is invalid`);
    }
  }
  let previousStart = -1;
  for (const [index, word] of transcript.words.entries()) {
    const wordKeys = new Set(["text", "startsAtSeconds", "endsAtSeconds"]);
    if (!word || typeof word !== "object" || Array.isArray(word)
        || Object.keys(word).some((key) => !wordKeys.has(key))
        || typeof word.text !== "string" || !word.text.trim() || word.text.length > 240
        || finite(word.startsAtSeconds, `word ${index + 1} start`) < 0
        || finite(word.endsAtSeconds, `word ${index + 1} end`) <= word.startsAtSeconds
        || word.startsAtSeconds < previousStart
        || word.endsAtSeconds * 1000 > prepared.prepare.analysis.durationMs + 250) {
      throw new CliError(`speech word ${index + 1} is invalid`);
    }
    previousStart = word.startsAtSeconds;
  }
  if (!Array.isArray(value.speakerTurns) || value.speakerTurns.length < 1 || value.speakerTurns.length > 10_000) {
    throw new CliError("speech speaker turns are invalid");
  }
  for (const [index, turn] of value.speakerTurns.entries()) {
    const turnKeys = new Set(["cluster", "startsAtSeconds", "endsAtSeconds", "confidence"]);
    if (!turn || typeof turn !== "object" || Array.isArray(turn)
        || Object.keys(turn).some((key) => !turnKeys.has(key))
        || typeof turn.cluster !== "string" || !turn.cluster || turn.cluster.length > 120
        || finite(turn.startsAtSeconds, `speaker turn ${index + 1} start`) < 0
        || finite(turn.endsAtSeconds, `speaker turn ${index + 1} end`) <= turn.startsAtSeconds
        || !Number.isFinite(turn.confidence) || turn.confidence < 0 || turn.confidence > 1) {
      throw new CliError(`speech speaker turn ${index + 1} is invalid`);
    }
  }
  return value;
}

export function cuesFromWords(words, durationMs) {
  const cues = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const startsAtMs = Math.max(cues.at(-1)?.endsAtMs ?? 0, Math.round(current[0].startsAtSeconds * 1000));
    const endsAtMs = Math.min(durationMs, Math.max(startsAtMs + 1, Math.round(current.at(-1).endsAtSeconds * 1000)));
    const textMarkdown = current.map(({ text }) => text.trim()).filter(Boolean).join(" ")
      .replace(/\s+([,.;:!?])/g, "$1").normalize("NFC");
    if (textMarkdown && endsAtMs > startsAtMs) cues.push({ startsAtMs, endsAtMs, textMarkdown });
    current = [];
  };
  for (const word of words) {
    const gapMs = current.length
      ? (word.startsAtSeconds - current.at(-1).endsAtSeconds) * 1000
      : 0;
    if (current.length && gapMs > 750) flush();
    current.push(word);
    const text = current.map((item) => item.text).join(" ");
    const spanMs = (current.at(-1).endsAtSeconds - current[0].startsAtSeconds) * 1000;
    if (/[.!?][\"')\]]?$/.test(word.text) || current.length >= 16 || text.length >= 110 || spanMs >= 6_000) flush();
  }
  flush();
  if (!cues.length) throw new CliError("Parakeet returned no reviewable words", { exitCode: EXIT.qualityGate });
  return cues;
}

async function existingAnalysis(projectRoot, prepared) {
  const speechPath = descendantPath(projectRoot, "analysis", "speech.json");
  const speakersPath = descendantPath(projectRoot, "analysis", "speaker-turns.json");
  const draftPath = descendantPath(projectRoot, "review", "draft.json");
  try {
    const [speech, speakers, draft] = await Promise.all([speechPath, speakersPath, draftPath].map(async (file) => {
      try { return JSON.parse(await fsp.readFile(file, "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    }));
    if (!speech && !speakers && !draft) return null;
    if (!speech || !speakers || !draft) throw new CliError("existing speech analysis is incomplete");
    return {
      speech: validateSpeechAnalysis(speech, prepared),
      speakers: validateSpeakerTurns(speakers),
      draft: validateReviewDraft(draft), speechPath, speakersPath, draftPath
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("existing speech analysis is incomplete or invalid");
  }
}

async function ensurePrivateDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CliError("analysis directory is unsafe");
}

export async function analyzeProject(projectPath, {
  parakeetModelPath,
  diarizationModelRoot = BUNDLED_MODELS_ROOT,
  speechPath = defaultToolPath("speech"),
  maximumSpeakers = 6
} = {}) {
  const prepared = await loadPreparedMedia(projectPath);
  const existing = await existingAnalysis(prepared.projectRoot, prepared);
  if (existing) return { ...prepared, ...existing };
  const modelPath = parakeetModelPath || process.env.PODCAST_VISUALIZER_PARAKEET_MODEL;
  if (!modelPath) {
    throw new CliError("a local Parakeet v3 model is required", {
      exitCode: EXIT.modelMissing,
      hint: "Pass --parakeet-model DIR or set PODCAST_VISUALIZER_PARAKEET_MODEL."
    });
  }
  if (!Number.isSafeInteger(maximumSpeakers) || maximumSpeakers < 1 || maximumSpeakers > 6) {
    throw new CliError("maximum speakers must be an integer from 1 through 6", { exitCode: EXIT.usage });
  }
  await validateBundledSpeechRuntime();
  const diarization = await validateBundledDiarizationModel(diarizationModelRoot);
  const analysisDirectory = descendantPath(prepared.projectRoot, "analysis");
  const reviewDirectory = descendantPath(prepared.projectRoot, "review");
  await ensurePrivateDirectory(analysisDirectory);
  await ensurePrivateDirectory(reviewDirectory);
  const temporary = descendantPath(
    prepared.projectRoot, "analysis", `.speech-${process.pid}-${randomBytes(8).toString("hex")}.json`
  );
  let speech;
  try {
    await runProcess(speechPath, [
      "--audio", prepared.analysisPath,
      "--parakeet-model", path.resolve(modelPath),
      "--diarization-model-root", diarization.modelRoot,
      "--output", temporary,
      "--maximum-speakers", String(maximumSpeakers)
    ], { label: "offline speech analysis", timeoutMs: 4 * 60 * 60 * 1000, maximumOutputBytes: 2 * 1024 * 1024 });
    speech = validateSpeechAnalysis(JSON.parse(await fsp.readFile(temporary, "utf8")), prepared);
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError("speech sidecar returned invalid JSON");
    throw error;
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
  const durationMs = prepared.prepare.analysis.durationMs;
  const rawTurns = speech.speakerTurns.map((turn) => ({
    cluster: turn.cluster,
    startsAtMs: Math.min(durationMs - 1, Math.max(0, Math.round(turn.startsAtSeconds * 1000))),
    endsAtMs: Math.min(durationMs, Math.max(1, Math.round(turn.endsAtSeconds * 1000))),
    confidence: turn.confidence
  })).filter((turn) => turn.endsAtMs > turn.startsAtMs);
  const speakers = buildSpeakerTurns({
    sourceAudioSha256: speech.sourceAudioSha256,
    durationMs,
    engine: speech.diarizationEngine,
    rawTurns
  });
  const draft = buildReviewDraft({
    sourceAudioSha256: speech.sourceAudioSha256,
    durationMs,
    transcription: {
      engine: speech.transcriptionEngine.name,
      version: speech.transcriptionEngine.version,
      model: speech.transcriptionEngine.model,
      modelVersion: speech.transcriptionEngine.modelVersion
    },
    cues: cuesFromWords(speech.transcript.words, durationMs),
    speakerTurns: speakers
  });
  const speechOutput = descendantPath(prepared.projectRoot, "analysis", "speech.json");
  const speakersOutput = descendantPath(prepared.projectRoot, "analysis", "speaker-turns.json");
  const draftOutput = descendantPath(prepared.projectRoot, "review", "draft.json");
  const linked = [];
  try {
    await writeNewJson(speechOutput, speech); linked.push(speechOutput);
    await writeNewJson(speakersOutput, speakers); linked.push(speakersOutput);
    await writeNewJson(draftOutput, draft); linked.push(draftOutput);
  } catch (error) {
    await Promise.all(linked.map((file) => fsp.unlink(file).catch(() => {})));
    throw error;
  }
  return {
    ...prepared, speech, speakers, draft,
    speechPath: speechOutput, speakersPath: speakersOutput, draftPath: draftOutput
  };
}
