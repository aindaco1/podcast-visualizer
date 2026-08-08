import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { SPEAKER_PALETTE } from "./speaker-turns.js";
import { isNonVisualFiller, WORD_PRESENTATION_POLICY_VERSION } from "./word-presentation.js";

export const SCENE_SCHEMA = "transcript-video-scene-v2";
export const SCENE_STYLE_VERSION = "dust-branded-v2";
export const SCENE_RENDERER_VERSION = "ass-scene-v4";

export const ASPECT_PRESETS = Object.freeze({
  "16:9": Object.freeze({
    width: 1920, height: 1080, marginX: 112, cardY: 172, cardWidth: 1696,
    fontSize: 92, maximumCharactersPerLine: 38, bitrate: "14M"
  }),
  "1:1": Object.freeze({
    width: 1080, height: 1080, marginX: 72, cardY: 174, cardWidth: 936,
    fontSize: 82, maximumCharactersPerLine: 22, bitrate: "10M"
  }),
  "9:16": Object.freeze({
    width: 1080, height: 1920, marginX: 64, cardY: 292, cardWidth: 952,
    fontSize: 80, maximumCharactersPerLine: 21, bitrate: "14M"
  })
});

const CUE_PLACEMENTS = Object.freeze({
  "16:9": Object.freeze([
    { anchor: 7, x: 0.07, y: 0.18 },
    { anchor: 8, x: 0.50, y: 0.12 },
    { anchor: 9, x: 0.93, y: 0.60 },
    { anchor: 7, x: 0.07, y: 0.62 },
    { anchor: 8, x: 0.50, y: 0.42 },
    { anchor: 9, x: 0.93, y: 0.22 }
  ]),
  "1:1": Object.freeze([
    { anchor: 7, x: 0.08, y: 0.16 },
    { anchor: 8, x: 0.50, y: 0.34 },
    { anchor: 9, x: 0.92, y: 0.60 },
    { anchor: 7, x: 0.08, y: 0.68 },
    { anchor: 8, x: 0.50, y: 0.12 }
  ]),
  "9:16": Object.freeze([
    { anchor: 8, x: 0.50, y: 0.15 },
    { anchor: 7, x: 0.07, y: 0.34 },
    { anchor: 9, x: 0.93, y: 0.52 },
    { anchor: 8, x: 0.50, y: 0.70 },
    { anchor: 7, x: 0.07, y: 0.78 }
  ])
});

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const SCENE_KEYS = new Set([
  "schemaVersion", "sceneId", "styleVersion", "rendererVersion", "aspect", "frameRate",
  "durationMs", "title", "brand", "inputs", "wordPresentation", "layout", "speakers", "cues",
  "manifestSha256"
]);
const BRAND_KEYS = new Set(["podcastName", "organizationName", "showSpeakerNames", "logo"]);
const LOGO_KEYS = new Set(["relativePath", "bytes", "sha256", "width", "height"]);
const WORD_PRESENTATION_KEYS = new Set([
  "policyVersion", "suppressFillers", "holdUntilNextVisibleWord"
]);

function boundedTitle(value) {
  const title = String(value ?? "DUST WAVE PODCAST").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(title)) {
    throw new CliError("render title is invalid", { exitCode: EXIT.usage });
  }
  return title;
}

function boundedOrganization(value) {
  const organization = String(value ?? "Dust Wave").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!organization || organization.length > 120
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(organization)) {
    throw new CliError("render organization name is invalid", { exitCode: EXIT.usage });
  }
  return organization;
}

function sceneLogo(value) {
  if (value === null || value === undefined) return null;
  const logo = {
    relativePath: value.relativePath,
    bytes: value.bytes,
    sha256: value.sha256,
    width: value.width,
    height: value.height
  };
  if (!/^branding\/assets\/logo_[a-f0-9]{64}\.png$/.test(logo.relativePath)
      || !Number.isSafeInteger(logo.bytes) || logo.bytes < 1 || logo.bytes > 10 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(logo.sha256)
      || !Number.isSafeInteger(logo.width) || !Number.isSafeInteger(logo.height)
      || logo.width < 128 || logo.height < 128 || logo.width > 4096 || logo.height > 4096) {
    throw new CliError("render logo is invalid", { exitCode: EXIT.usage });
  }
  return logo;
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

function lineBreaks(words, maximumCharacters) {
  const widths = words.map(({ text }) => [...text].length);
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1);
  const lineCount = Math.min(words.length, Math.max(1, Math.ceil(total / maximumCharacters)));
  if (lineCount === 1) return [];
  const target = total / lineCount;
  const costs = Array.from({ length: lineCount + 1 }, () => Array(words.length + 1).fill(Infinity));
  const previous = Array.from({ length: lineCount + 1 }, () => Array(words.length + 1).fill(-1));
  costs[0][0] = 0;
  const widthBetween = (start, end) => widths.slice(start, end).reduce((sum, width) => sum + width, 0)
    + Math.max(0, end - start - 1);
  for (let line = 1; line <= lineCount; line += 1) {
    for (let end = line; end <= words.length; end += 1) {
      for (let start = line - 1; start < end; start += 1) {
        if (!Number.isFinite(costs[line - 1][start])) continue;
        const width = widthBetween(start, end);
        const overflow = Math.max(0, width - maximumCharacters);
        const orphanPenalty = end - start === 1 && words.length > lineCount ? target * target : 0;
        const cost = costs[line - 1][start] + (width - target) ** 2
          + overflow * overflow * 10_000 + orphanPenalty;
        if (cost < costs[line][end]) {
          costs[line][end] = cost;
          previous[line][end] = start;
        }
      }
    }
  }
  const breaks = [];
  let end = words.length;
  for (let line = lineCount; line > 1; line -= 1) {
    const start = previous[line][end];
    if (start < 1) throw new CliError("scene line wrapping failed");
    breaks.push(start);
    end = start;
  }
  return breaks.reverse();
}

function cuePlacement(aspect, index, speakerId, preset) {
  const placements = CUE_PLACEMENTS[aspect];
  const speakerIndex = Number(speakerId.slice(-2)) - 1;
  const selected = placements[(index + speakerIndex * 2) % placements.length];
  return {
    anchor: selected.anchor,
    x: Math.round(selected.x * preset.width),
    y: Math.round(selected.y * preset.height)
  };
}

export function buildScene({
  transcript,
  alignment,
  aspect,
  title,
  branding = {},
  style = "dust-subtle",
  titleDurationMs = 2000
}) {
  const preset = ASPECT_PRESETS[aspect];
  if (!preset) throw new CliError("--aspect must be 16:9, 1:1, 9:16, or all", { exitCode: EXIT.usage });
  if (!alignment?.manifest || !alignment?.quality || !transcript?.projection) {
    throw new CliError("scene inputs are invalid");
  }
  if (!branding || typeof branding !== "object" || Array.isArray(branding)
      || (branding.showSpeakerNames !== undefined && typeof branding.showSpeakerNames !== "boolean")
      || (transcript.speakers !== undefined && !Array.isArray(transcript.speakers))) {
    throw new CliError("scene branding inputs are invalid");
  }
  if (!["dust-subtle", "transcript-only"].includes(style)) {
    throw new CliError("--style must be dust-subtle or transcript-only", { exitCode: EXIT.usage });
  }
  if (!Number.isSafeInteger(titleDurationMs) || titleDurationMs < 1500 || titleDurationMs > 2500) {
    throw new CliError("title duration must be between 1500 and 2500 ms");
  }
  const brand = {
    podcastName: boundedTitle(title ?? branding.podcastName),
    organizationName: boundedOrganization(branding.organizationName),
    showSpeakerNames: branding.showSpeakerNames !== false,
    logo: sceneLogo(branding.logo)
  };
  const speakerNames = new Map((transcript.speakers ?? []).map((speaker) => [speaker.id, speaker.displayName]));
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
    }).filter((word, wordIndex) => !isNonVisualFiller(projectionCue.words[wordIndex].text));
    if (!words.length) return null;
    const speakerId = cue.speakerLabel;
    return {
      cueId: cue.id,
      speakerId,
      startsAtMs: words[0].startsAtMs,
      endsAtMs: words.at(-1).endsAtMs,
      position: cuePlacement(aspect, cueIndex, speakerId, preset),
      lineBreakBeforeWordIndexes: lineBreaks(words, preset.maximumCharactersPerLine),
      words
    };
  }).filter(Boolean);
  if (!cues.length) throw new CliError("no visual words remain after filler suppression");
  const visibleWords = cues.flatMap((cue) => cue.words);
  const sceneEndMs = titleDurationMs + transcript.durationMs;
  for (const [index, word] of visibleWords.entries()) {
    const nextStart = visibleWords[index + 1]?.startsAtMs ?? sceneEndMs;
    if (!Number.isSafeInteger(nextStart) || nextStart <= word.startsAtMs) {
      throw new CliError(`scene word ${word.wordId} has non-monotonic visible timing`);
    }
    word.endsAtMs = nextStart;
  }
  for (const cue of cues) {
    cue.startsAtMs = cue.words[0].startsAtMs;
    cue.endsAtMs = cue.words.at(-1).endsAtMs;
  }
  const speakerIds = [...new Set(cues.map(({ speakerId }) => speakerId))].sort();
  const speakers = speakerIds.map((speakerId) => {
    const index = Number(speakerId.slice(-2)) - 1;
    const palette = SPEAKER_PALETTE[index % SPEAKER_PALETTE.length];
    if (!Number.isSafeInteger(index) || index < 0 || !palette) {
      throw new CliError(`scene speaker is invalid: ${speakerId}`);
    }
    const displayName = speakerNames.get(speakerId) ?? `Speaker ${index + 1}`;
    if (typeof displayName !== "string" || displayName !== displayName.normalize("NFC").trim()
        || [...displayName].length < 1 || [...displayName].length > 60
        || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
      throw new CliError(`scene speaker name is invalid: ${speakerId}`);
    }
    return { id: speakerId, displayName, ...palette };
  });
  const base = {
    styleVersion: style === "dust-subtle" ? SCENE_STYLE_VERSION : "transcript-only-v1",
    rendererVersion: SCENE_RENDERER_VERSION,
    aspect,
    frameRate: 24,
    durationMs: titleDurationMs + transcript.durationMs,
    title: { text: brand.podcastName, startsAtMs: 0, endsAtMs: titleDurationMs },
    brand,
    inputs: {
      transcriptId: transcript.transcriptId,
      transcriptManifestSha256: transcript.manifestSha256,
      alignmentRevisionId: alignment.manifest.alignmentRevisionId,
      alignmentManifestSha256: alignment.manifestSha256,
      sourceAudioSha256: transcript.sourceAudioSha256
    },
    wordPresentation: {
      policyVersion: WORD_PRESENTATION_POLICY_VERSION,
      suppressFillers: true,
      holdUntilNextVisibleWord: true
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
      || value.rendererVersion !== SCENE_RENDERER_VERSION
      || ![SCENE_STYLE_VERSION, "transcript-only-v1"].includes(value.styleVersion)
      || !ASPECT_PRESETS[value.aspect] || value.frameRate !== 24
      || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1
      || !Array.isArray(value.cues) || value.cues.length < 1
      || !Array.isArray(value.speakers) || value.speakers.length < 1) {
    throw new CliError("scene identity is invalid");
  }
  if (!value.brand || typeof value.brand !== "object" || Array.isArray(value.brand)
      || Object.keys(value.brand).length !== BRAND_KEYS.size
      || Object.keys(value.brand).some((key) => !BRAND_KEYS.has(key))
      || boundedTitle(value.brand.podcastName) !== value.brand.podcastName
      || boundedOrganization(value.brand.organizationName) !== value.brand.organizationName
      || typeof value.brand.showSpeakerNames !== "boolean") {
    throw new CliError("scene brand is invalid");
  }
  if (value.brand.logo !== null) {
    if (!value.brand.logo || typeof value.brand.logo !== "object" || Array.isArray(value.brand.logo)
        || Object.keys(value.brand.logo).length !== LOGO_KEYS.size
        || Object.keys(value.brand.logo).some((key) => !LOGO_KEYS.has(key))) {
      throw new CliError("scene logo is invalid");
    }
    sceneLogo(value.brand.logo);
  }
  if (!value.title || typeof value.title !== "object" || Array.isArray(value.title)
      || Object.keys(value.title).length !== 3
      || value.title.text !== value.brand.podcastName || value.title.startsAtMs !== 0
      || !Number.isSafeInteger(value.title.endsAtMs)
      || value.title.endsAtMs < 1500 || value.title.endsAtMs > 2500) {
    throw new CliError("scene title is invalid");
  }
  const speakerIDs = new Set();
  for (const speaker of value.speakers) {
    if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)
        || Object.keys(speaker).length !== 5
        || !/^speaker-(?:0[1-9]|[1-9][0-9])$/.test(speaker.id)
        || speakerIDs.has(speaker.id)
        || typeof speaker.displayName !== "string"
        || speaker.displayName !== speaker.displayName.normalize("NFC").trim()
        || [...speaker.displayName].length < 1 || [...speaker.displayName].length > 60
        || /[\p{Cc}\p{Cf}]/u.test(speaker.displayName)
        || typeof speaker.token !== "string"
        || !/^#[a-f0-9]{6}$/i.test(speaker.bright) || !/^#[a-f0-9]{6}$/i.test(speaker.dim)) {
      throw new CliError("scene speaker is invalid");
    }
    speakerIDs.add(speaker.id);
  }
  const expectedLayout = ASPECT_PRESETS[value.aspect];
  if (!value.layout || typeof value.layout !== "object" || Array.isArray(value.layout)
      || Object.keys(expectedLayout).some((key) => value.layout[key] !== expectedLayout[key])
      || Object.keys(value.layout).length !== Object.keys(expectedLayout).length) {
    throw new CliError("scene layout is invalid");
  }
  if (!value.wordPresentation || typeof value.wordPresentation !== "object"
      || Array.isArray(value.wordPresentation)
      || Object.keys(value.wordPresentation).some((key) => !WORD_PRESENTATION_KEYS.has(key))
      || Object.keys(value.wordPresentation).length !== WORD_PRESENTATION_KEYS.size
      || value.wordPresentation.policyVersion !== WORD_PRESENTATION_POLICY_VERSION
      || value.wordPresentation.suppressFillers !== true
      || value.wordPresentation.holdUntilNextVisibleWord !== true) {
    throw new CliError("scene word presentation policy is invalid");
  }
  const visibleWords = [];
  for (const cue of value.cues) {
    if (!speakerIDs.has(cue.speakerId)
        || ![7, 8, 9].includes(cue.position?.anchor)
        || !Number.isSafeInteger(cue.position?.x) || cue.position.x < 0 || cue.position.x > value.layout.width
        || !Number.isSafeInteger(cue.position?.y) || cue.position.y < 0 || cue.position.y > value.layout.height
        || !Array.isArray(cue.words) || cue.words.length < 1) {
      throw new CliError("scene cue position is invalid");
    }
    const firstWord = cue.words[0];
    const lastWord = cue.words.at(-1);
    if (cue.startsAtMs !== firstWord.startsAtMs || cue.endsAtMs !== lastWord.endsAtMs) {
      throw new CliError("scene cue timing is inconsistent");
    }
    for (const word of cue.words) {
      if (typeof word.wordId !== "string" || !word.wordId.startsWith("word_")
          || typeof word.text !== "string" || !word.text.trim()
          || !Number.isSafeInteger(word.startsAtMs) || !Number.isSafeInteger(word.endsAtMs)
          || word.startsAtMs < 0 || word.endsAtMs <= word.startsAtMs
          || word.endsAtMs > value.durationMs) {
        throw new CliError("scene word timing is invalid");
      }
      visibleWords.push(word);
    }
  }
  for (const [index, word] of visibleWords.entries()) {
    const expectedEnd = visibleWords[index + 1]?.startsAtMs ?? value.durationMs;
    if (word.endsAtMs !== expectedEnd) {
      throw new CliError("scene visible-word hold timing is invalid");
    }
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
        brand: value.brand,
        inputs: value.inputs,
        wordPresentation: value.wordPresentation,
        layout: value.layout,
        speakers: value.speakers,
        cues: value.cues
      }).slice(0, 24)}`) {
    throw new CliError("scene hash does not match");
  }
  return value;
}
