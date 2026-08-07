import { sha256 } from "./canonical-json.js";
import { CliError } from "./errors.js";

export const SPEAKER_TURNS_SCHEMA = "speaker-turns-v1";
export const MAXIMUM_SPEAKERS = 6;
export const SPEAKER_PALETTE = Object.freeze([
  { token: "dust-coral", bright: "#F28B82", dim: "#593638" },
  { token: "dust-cyan", bright: "#78C6D0", dim: "#29484F" },
  { token: "dust-amber", bright: "#E5B567", dim: "#54442A" },
  { token: "dust-sage", bright: "#91B49A", dim: "#34463A" },
  { token: "dust-lavender", bright: "#B7A6D9", dim: "#403951" },
  { token: "dust-warm-gray", bright: "#C4B9AE", dim: "#47423E" }
]);

const DIGEST = /^[a-f0-9]{64}$/;
const SPEAKER_ID = /^speaker-0[1-6]$/;
const ORIGINS = new Set(["model", "editor"]);

function boundedTime(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CliError(`${label} is invalid`);
  }
  return value;
}

export function buildSpeakerTurns({ sourceAudioSha256, durationMs, engine, rawTurns }) {
  if (!DIGEST.test(sourceAudioSha256)) throw new CliError("speaker source hash is invalid");
  boundedTime(durationMs, 1, 24 * 60 * 60 * 1000, "speaker duration");
  if (!engine || typeof engine !== "object" || Array.isArray(engine)) {
    throw new CliError("diarization engine identity is invalid");
  }
  for (const key of ["name", "version", "model", "modelVersion", "settingsVersion"]) {
    if (typeof engine[key] !== "string" || !engine[key] || engine[key].length > 180) {
      throw new CliError(`diarization engine ${key} is invalid`);
    }
  }
  if (!Array.isArray(rawTurns) || rawTurns.length < 1 || rawTurns.length > 10000) {
    throw new CliError("diarization turns are invalid");
  }

  const clusterOrder = [];
  const normalizedRaw = rawTurns.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      throw new CliError(`speaker turn ${index + 1} is invalid`);
    }
    const cluster = String(turn.cluster ?? "");
    if (!cluster || cluster.length > 120) throw new CliError(`speaker turn ${index + 1} cluster is invalid`);
    if (!clusterOrder.includes(cluster)) clusterOrder.push(cluster);
    if (clusterOrder.length > MAXIMUM_SPEAKERS) {
      throw new CliError(`diarization found more than ${MAXIMUM_SPEAKERS} speakers`);
    }
    const startsAtMs = boundedTime(turn.startsAtMs, 0, durationMs - 1, `speaker turn ${index + 1} start`);
    const endsAtMs = boundedTime(turn.endsAtMs, 1, durationMs, `speaker turn ${index + 1} end`);
    if (endsAtMs <= startsAtMs) throw new CliError(`speaker turn ${index + 1} range is invalid`);
    const confidence = turn.confidence === null || turn.confidence === undefined
      ? null
      : Number(turn.confidence);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new CliError(`speaker turn ${index + 1} confidence is invalid`);
    }
    return { cluster, startsAtMs, endsAtMs, confidence };
  }).sort((left, right) => left.startsAtMs - right.startsAtMs || left.endsAtMs - right.endsAtMs);

  for (let index = 1; index < normalizedRaw.length; index += 1) {
    if (normalizedRaw[index].startsAtMs < normalizedRaw[index - 1].startsAtMs) {
      throw new CliError("speaker turns are not monotonic");
    }
  }

  const clusterMap = new Map(clusterOrder.map((cluster, index) => [cluster, `speaker-${String(index + 1).padStart(2, "0")}`]));
  const speakers = clusterOrder.map((cluster, index) => ({
    id: clusterMap.get(cluster),
    colorToken: SPEAKER_PALETTE[index].token,
    bright: SPEAKER_PALETTE[index].bright,
    dim: SPEAKER_PALETTE[index].dim
  }));
  const turns = normalizedRaw.map((turn, index) => ({
    id: `turn_${String(index + 1).padStart(6, "0")}`,
    startsAtMs: turn.startsAtMs,
    endsAtMs: turn.endsAtMs,
    speakerId: clusterMap.get(turn.cluster),
    confidence: turn.confidence,
    origin: "model",
    confirmed: false
  }));
  const body = {
    schemaVersion: SPEAKER_TURNS_SCHEMA,
    sourceAudioSha256,
    durationMs,
    engine: Object.fromEntries(["name", "version", "model", "modelVersion", "settingsVersion"].map((key) => [key, engine[key]])),
    speakers,
    turns
  };
  return { ...body, manifestSha256: sha256(body) };
}

export function validateSpeakerTurns(value) {
  const allowed = new Set([
    "schemaVersion", "sourceAudioSha256", "durationMs", "engine", "speakers", "turns", "manifestSha256"
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("speaker document is invalid");
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new CliError(`speaker document contains unknown field: ${key}`);
  if (value.schemaVersion !== SPEAKER_TURNS_SCHEMA || !DIGEST.test(value.sourceAudioSha256)) {
    throw new CliError("speaker document identity is invalid");
  }
  boundedTime(value.durationMs, 1, 24 * 60 * 60 * 1000, "speaker duration");
  if (!Array.isArray(value.speakers) || value.speakers.length < 1 || value.speakers.length > MAXIMUM_SPEAKERS) {
    throw new CliError("speaker list is invalid");
  }
  const speakerIds = new Set();
  value.speakers.forEach((speaker, index) => {
    if (!speaker || !SPEAKER_ID.test(speaker.id) || speakerIds.has(speaker.id)) {
      throw new CliError(`speaker ${index + 1} is invalid`);
    }
    speakerIds.add(speaker.id);
    const expected = SPEAKER_PALETTE[index];
    if (speaker.colorToken !== expected.token || speaker.bright !== expected.bright || speaker.dim !== expected.dim) {
      throw new CliError(`speaker ${index + 1} palette is invalid`);
    }
  });
  if (!Array.isArray(value.turns) || value.turns.length < 1 || value.turns.length > 10000) {
    throw new CliError("speaker turn list is invalid");
  }
  let previousStart = -1;
  value.turns.forEach((turn, index) => {
    if (turn.id !== `turn_${String(index + 1).padStart(6, "0")}` || !speakerIds.has(turn.speakerId)) {
      throw new CliError(`speaker turn ${index + 1} identity is invalid`);
    }
    boundedTime(turn.startsAtMs, 0, value.durationMs - 1, `speaker turn ${index + 1} start`);
    boundedTime(turn.endsAtMs, 1, value.durationMs, `speaker turn ${index + 1} end`);
    if (turn.endsAtMs <= turn.startsAtMs || turn.startsAtMs < previousStart) {
      throw new CliError(`speaker turn ${index + 1} timing is invalid`);
    }
    previousStart = turn.startsAtMs;
    if (!ORIGINS.has(turn.origin) || typeof turn.confirmed !== "boolean") {
      throw new CliError(`speaker turn ${index + 1} review state is invalid`);
    }
  });
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("speaker document hash does not match");
  return value;
}

export function speakerForWindow(startsAtMs, endsAtMs, document) {
  validateSpeakerTurns(document);
  const duration = endsAtMs - startsAtMs;
  const overlaps = new Map(document.speakers.map(({ id }) => [id, 0]));
  for (const turn of document.turns) {
    const overlap = Math.max(0, Math.min(endsAtMs, turn.endsAtMs) - Math.max(startsAtMs, turn.startsAtMs));
    overlaps.set(turn.speakerId, overlaps.get(turn.speakerId) + overlap);
  }
  const ranked = [...overlaps].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [winner, runnerUp] = ranked;
  const ratio = duration > 0 ? winner[1] / duration : 0;
  const ambiguous = winner[1] === 0 || ratio < 0.5
    || Boolean(runnerUp && runnerUp[1] > 0 && winner[1] - runnerUp[1] < duration * 0.2);
  return { speakerId: ambiguous ? "unknown" : winner[0], confidence: ratio, ambiguous };
}
