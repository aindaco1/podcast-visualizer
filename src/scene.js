import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { SPEAKER_PALETTE } from "./speaker-turns.js";

export const SCENE_SCHEMA = "transcript-video-scene-v1";
export const SCENE_STYLE_VERSION = "dust-subtle-v1";
export const SCENE_RENDERER_VERSION = "ass-scene-v1";

export const ASPECT_PRESETS = Object.freeze({
  "16:9": Object.freeze({
    width: 1920, height: 1080, marginX: 140, cardY: 210, cardWidth: 900,
    fontSize: 64, maximumWordsPerLine: 9, bitrate: "14M"
  }),
  "1:1": Object.freeze({
    width: 1080, height: 1080, marginX: 88, cardY: 210, cardWidth: 800,
    fontSize: 58, maximumWordsPerLine: 7, bitrate: "10M"
  }),
  "9:16": Object.freeze({
    width: 1080, height: 1920, marginX: 70, cardY: 360, cardWidth: 900,
    fontSize: 60, maximumWordsPerLine: 5, bitrate: "14M"
  })
});

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const SCENE_KEYS = new Set([
  "schemaVersion", "sceneId", "styleVersion", "rendererVersion", "aspect", "frameRate",
  "durationMs", "title", "inputs", "layout", "speakers", "cues", "manifestSha256"
]);

function boundedTitle(value) {
  const title = String(value ?? "DUST WAVE PODCAST").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(title)) {
    throw new CliError("render title is invalid", { exitCode: EXIT.usage });
  }
  return title;
}

function displayWords(text, projectedWords) {
  const matches = [...String(text).matchAll(WORD_PATTERN)];
  if (matches.length !== projectedWords.length) {
    throw new CliError("reviewed cue no longer matches its alignment projection");
  }
  return matches.map((match, index) => {
    const nextStart = matches[index + 1]?.index ?? text.length;
    const prefix = index === 0 ? text.slice(0, match.index) : "";
    const visible = `${prefix}${text.slice(match.index, nextStart)}`.trim();
    return visible || projectedWords[index].text;
  });
}

function lineBreaks(wordCount, maximum) {
  if (wordCount <= maximum) return [];
  const lineCount = Math.ceil(wordCount / maximum);
  const base = Math.floor(wordCount / lineCount);
  const extra = wordCount % lineCount;
  const breaks = [];
  let cursor = 0;
  for (let line = 0; line < lineCount - 1; line += 1) {
    cursor += base + (line < extra ? 1 : 0);
    breaks.push(cursor);
  }
  return breaks;
}

export function buildScene({
  transcript,
  alignment,
  aspect,
  title = "DUST WAVE PODCAST",
  style = "dust-subtle",
  titleDurationMs = 2000
}) {
  const preset = ASPECT_PRESETS[aspect];
  if (!preset) throw new CliError("--aspect must be 16:9, 1:1, 9:16, or all", { exitCode: EXIT.usage });
  if (!alignment?.manifest || !alignment?.quality || !transcript?.projection) {
    throw new CliError("scene inputs are invalid");
  }
  if (!["dust-subtle", "transcript-only"].includes(style)) {
    throw new CliError("--style must be dust-subtle or transcript-only", { exitCode: EXIT.usage });
  }
  if (!Number.isSafeInteger(titleDurationMs) || titleDurationMs < 1500 || titleDurationMs > 2500) {
    throw new CliError("title duration must be between 1500 and 2500 ms");
  }
  const candidateById = new Map(alignment.manifest.candidateWords.map((word) => [word.wordId, word]));
  const cues = transcript.cues.map((cue, cueIndex) => {
    const projectionCue = transcript.projection.cues[cueIndex];
    if (!projectionCue || projectionCue.cueId !== cue.id) {
      throw new CliError("scene cue projection is inconsistent");
    }
    const decorated = displayWords(cue.textMarkdown, projectionCue.words);
    const words = projectionCue.words.map((projected, wordIndex) => {
      const candidate = candidateById.get(projected.wordId);
      if (!candidate || candidate.cueId !== cue.id
          || !Number.isSafeInteger(candidate.startsAtMs) || !Number.isSafeInteger(candidate.endsAtMs)
          || candidate.endsAtMs <= candidate.startsAtMs) {
        throw new CliError(`scene word ${projected.wordId} has no usable alignment`);
      }
      return {
        wordId: projected.wordId,
        text: decorated[wordIndex],
        startsAtMs: titleDurationMs + candidate.startsAtMs,
        endsAtMs: titleDurationMs + candidate.endsAtMs,
        timingOrigin: candidate.timingOrigin
      };
    });
    return {
      cueId: cue.id,
      speakerId: cue.speakerLabel,
      startsAtMs: titleDurationMs + cue.startsAtMs,
      endsAtMs: titleDurationMs + cue.endsAtMs,
      lineBreakBeforeWordIndexes: lineBreaks(words.length, preset.maximumWordsPerLine),
      words
    };
  });
  const speakerIds = [...new Set(cues.map(({ speakerId }) => speakerId))].sort();
  const speakers = speakerIds.map((speakerId) => {
    const index = Number(speakerId.slice(-2)) - 1;
    const palette = SPEAKER_PALETTE[index];
    if (!palette) throw new CliError(`scene speaker is invalid: ${speakerId}`);
    return { id: speakerId, ...palette };
  });
  const base = {
    styleVersion: style === "dust-subtle" ? SCENE_STYLE_VERSION : "transcript-only-v1",
    rendererVersion: SCENE_RENDERER_VERSION,
    aspect,
    frameRate: 24,
    durationMs: titleDurationMs + transcript.durationMs,
    title: { text: boundedTitle(title), startsAtMs: 0, endsAtMs: titleDurationMs },
    inputs: {
      transcriptId: transcript.transcriptId,
      transcriptManifestSha256: transcript.manifestSha256,
      alignmentRevisionId: alignment.manifest.alignmentRevisionId,
      alignmentManifestSha256: alignment.manifestSha256,
      sourceAudioSha256: transcript.sourceAudioSha256
    },
    layout: { ...preset },
    speakers,
    cues
  };
  const sceneId = `scene_${sha256(base).slice(0, 24)}`;
  const body = { schemaVersion: SCENE_SCHEMA, sceneId, ...base };
  return { ...body, manifestSha256: sha256(body) };
}

export function validateScene(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("scene is invalid");
  for (const key of Object.keys(value)) if (!SCENE_KEYS.has(key)) throw new CliError(`scene contains unknown field: ${key}`);
  if (value.schemaVersion !== SCENE_SCHEMA || !/^scene_[a-f0-9]{24}$/.test(value.sceneId)
      || !ASPECT_PRESETS[value.aspect] || value.frameRate !== 24
      || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1
      || !Array.isArray(value.cues) || value.cues.length < 1
      || !Array.isArray(value.speakers) || value.speakers.length < 1) {
    throw new CliError("scene identity is invalid");
  }
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)
      || value.sceneId !== `scene_${sha256({
        styleVersion: value.styleVersion,
        rendererVersion: value.rendererVersion,
        aspect: value.aspect,
        frameRate: value.frameRate,
        durationMs: value.durationMs,
        title: value.title,
        inputs: value.inputs,
        layout: value.layout,
        speakers: value.speakers,
        cues: value.cues
      }).slice(0, 24)}`) {
    throw new CliError("scene hash does not match");
  }
  return value;
}
