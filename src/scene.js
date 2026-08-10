import {
  DEFAULT_TIMED_TEXT_PRESENTATION_POLICY,
  planTimedTextPresentation,
  TIMED_TEXT_PRESENTATION_POLICY_VERSION
} from "@dustwave/timed-text/presentation";

import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { INTER_METRICS_VERSION, measureInterText } from "./inter-metrics.js";
import {
  applyPresentationPunctuation, capitalizeSentenceStart,
  PRESENTATION_PUNCTUATION_POLICY_VERSION, presentationCapitalizationTrigger
} from "./presentation-punctuation.js";
import { SPEAKER_PALETTE } from "./speaker-turns.js";
import { isNonVisualFiller, WORD_PRESENTATION_POLICY_VERSION } from "./word-presentation.js";

export const SCENE_SCHEMA = "transcript-video-scene-v4";
export const SCENE_STYLE_VERSION = "dust-branded-v3";
export const SCENE_RENDERER_VERSION = "ass-scene-v6";
export const READABILITY_REPORT_SCHEMA = "readability-report-v2";

export const ASPECT_PRESETS = Object.freeze({
  "16:9": Object.freeze({
    width: 1920, height: 1080, marginX: 112, cardY: 172, cardWidth: 1696,
    fontSize: 92, maximumDialogueLines: 2, bitrate: "14M"
  }),
  "1:1": Object.freeze({
    width: 1080, height: 1080, marginX: 72, cardY: 174, cardWidth: 936,
    fontSize: 82, maximumDialogueLines: 2, bitrate: "10M"
  }),
  "9:16": Object.freeze({
    width: 1080, height: 1920, marginX: 64, cardY: 292, cardWidth: 952,
    fontSize: 80, maximumDialogueLines: 2, bitrate: "14M"
  })
});

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const SCENE_KEYS = new Set([
  "schemaVersion", "sceneId", "styleVersion", "rendererVersion", "aspect", "frameRate",
  "durationMs", "title", "brand", "inputs", "wordPresentation", "layout", "speakers", "cues",
  "readability", "manifestSha256"
]);
const BRAND_KEYS = new Set(["podcastName", "organizationName", "showSpeakerNames", "logo"]);
const LOGO_KEYS = new Set(["relativePath", "bytes", "sha256", "width", "height"]);
const WORD_PRESENTATION_KEYS = new Set([
  "policyVersion", "presentationPolicyVersion", "punctuationPolicyVersion", "fontMetricsVersion",
  "suppressFillers", "holdUntilNextVisibleWord"
]);
const READABILITY_KEYS = new Set([
  "schemaVersion", "sourceWordCount", "visibleWordCount", "suppressedWordCount",
  "sourceWordSequenceSha256", "visibleWordSequenceSha256", "punctuationOperations",
  "capitalizationOperations", "metrics"
]);
const READABILITY_METRIC_KEYS = new Set([
  "wordCount", "cueCount", "maximumLines", "maximumLineWidth",
  "maximumCharactersPerSecond", "fastCueCount", "shortCueCount", "overlongWordCount"
]);
const PUNCTUATION_OPERATION_KEYS = new Set(["afterWordId", "mark", "reason"]);
const PUNCTUATION_MARKS = new Set([",", "—"]);
const PUNCTUATION_REASONS = new Set([
  "emphatic-repetition", "parenthetical-discourse-marker", "same-speaker-restart"
]);
const CAPITALIZATION_OPERATION_KEYS = new Set(["wordId", "reason", "trigger"]);
const CAPITALIZATION_TRIGGERS = new Set([
  "sequence-start", "speaker-change", "terminal-punctuation"
]);
const CUE_KEYS = new Set([
  "cueId", "sourceCueIds", "speakerId", "spokenStartsAtMs", "spokenEndsAtMs",
  "displayStartsAtMs", "displayEndsAtMs", "position", "lineBreakBeforeWordIndexes",
  "lineWidths", "charactersPerSecond", "plate", "words"
]);
const POSITION_KEYS = new Set(["anchor", "x", "y"]);
const PLATE_KEYS = new Set(["x", "y", "width", "height"]);
const PRESENTED_WORD_KEYS = new Set([
  "wordId", "sourceText", "text", "spokenStartsAtMs", "spokenEndsAtMs",
  "highlightStartsAtMs", "highlightEndsAtMs", "timingOrigin"
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

function presentationPolicy(aspect, preset) {
  const aspectTargets = {
    "16:9": { minimumWordsPerCue: 3, targetWordsPerCue: 9, maximumWordsPerCue: 14 },
    "1:1": { minimumWordsPerCue: 2, targetWordsPerCue: 7, maximumWordsPerCue: 12 },
    "9:16": { minimumWordsPerCue: 2, targetWordsPerCue: 6, maximumWordsPerCue: 10 }
  };
  return {
    ...DEFAULT_TIMED_TEXT_PRESENTATION_POLICY,
    ...aspectTargets[aspect],
    maximumLines: preset.maximumDialogueLines,
    maximumLineWidth: preset.cardWidth,
    spaceWidth: measureInterText(" ", preset.fontSize),
    maximumCandidateWords: 18
  };
}

function cuePlacement(speakerId, preset) {
  const speakerIndex = Number(speakerId.slice(-2)) - 1;
  const shift = (speakerIndex % 3 - 1) * Math.round(preset.fontSize * 0.12);
  return {
    anchor: 7,
    x: preset.marginX,
    y: preset.cardY + shift
  };
}

function cuePlate(cue, speakerName, showSpeakerNames, preset) {
  const paddingX = Math.round(preset.fontSize * 0.28);
  const paddingY = Math.round(preset.fontSize * 0.22);
  const dialogueWidth = Math.max(...cue.lineWidths);
  const speakerWidth = showSpeakerNames
    ? measureInterText(speakerName, Math.round(preset.fontSize * 0.34))
    : 0;
  const speakerHeight = showSpeakerNames ? Math.round(preset.fontSize * 0.48) : 0;
  const dialogueHeight = Math.round(cue.lineWidths.length * preset.fontSize * 1.13);
  return {
    x: cue.position.x - paddingX,
    y: cue.position.y - paddingY,
    width: Math.min(preset.width - cue.position.x, Math.max(dialogueWidth, speakerWidth) + paddingX * 2),
    height: speakerHeight + dialogueHeight + paddingY * 2
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
  const sourceWords = transcript.cues.flatMap((cue, cueIndex) => {
    const projectionCue = transcript.projection.cues[cueIndex];
    if (!projectionCue || projectionCue.cueId !== cue.id) {
      throw new CliError("scene cue projection is inconsistent");
    }
    const decorated = displayWords(cue.textMarkdown, projectionCue.words);
    return projectionCue.words.map((projected, wordIndex) => {
      const candidate = candidateById.get(projected.wordId);
      if (!candidate || candidate.cueId !== cue.id
          || !Number.isSafeInteger(candidate.startsAtMs) || !Number.isSafeInteger(candidate.endsAtMs)
          || candidate.endsAtMs <= candidate.startsAtMs
          || typeof candidate.timingOrigin !== "string" || !candidate.timingOrigin) {
        throw new CliError(`scene word ${projected.wordId} has no usable alignment`);
      }
      return {
        wordId: projected.wordId,
        sourceText: decorated[wordIndex],
        text: decorated[wordIndex],
        startsAtMs: titleDurationMs + candidate.startsAtMs,
        endsAtMs: titleDurationMs + candidate.endsAtMs,
        speakerId: cue.speakerLabel,
        sourceCueId: cue.id,
        projectedText: projected.text,
        timingOrigin: candidate.timingOrigin
      };
    });
  });
  const visibleSourceWords = [];
  const effectiveGapByWordId = new Map();
  let priorVisibleSourceIndex = -1;
  for (const [sourceIndex, word] of sourceWords.entries()) {
    if (isNonVisualFiller(word.projectedText)) continue;
    let maximumGapMs = 0;
    for (let index = Math.max(1, priorVisibleSourceIndex + 1); index <= sourceIndex; index += 1) {
      if (sourceWords[index].speakerId !== sourceWords[index - 1].speakerId) continue;
      maximumGapMs = Math.max(
        maximumGapMs,
        Math.max(0, sourceWords[index].startsAtMs - sourceWords[index - 1].endsAtMs)
      );
    }
    effectiveGapByWordId.set(word.wordId, maximumGapMs);
    visibleSourceWords.push(word);
    priorVisibleSourceIndex = sourceIndex;
  }
  if (!visibleSourceWords.length) throw new CliError("no visual words remain after filler suppression");
  const punctuation = applyPresentationPunctuation(visibleSourceWords.map(({ projectedText, ...word }) => word));
  const sceneEndMs = titleDurationMs + transcript.durationMs;
  const plannedWords = punctuation.words.map((word) => ({
    ...word,
    displayWidth: measureInterText(word.text, preset.fontSize),
    gapBeforeMs: effectiveGapByWordId.get(word.wordId) ?? 0
  }));
  const policy = presentationPolicy(aspect, preset);
  const presentation = planTimedTextPresentation(plannedWords.map((word) => ({
    wordId: word.wordId,
    text: word.text,
    startsAtMs: word.startsAtMs,
    endsAtMs: word.endsAtMs,
    speakerId: word.speakerId,
    sourceCueId: word.sourceCueId,
    displayWidth: word.displayWidth,
    gapBeforeMs: word.gapBeforeMs
  })), { durationMs: sceneEndMs, policy });
  const speakerIds = [...new Set(plannedWords.map(({ speakerId }) => speakerId))].sort();
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
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const cues = presentation.cues.map((plannedCue, cueIndex) => {
    const slice = plannedWords.slice(plannedCue.wordStartIndex, plannedCue.wordEndIndex + 1);
    const words = slice.map((word) => ({
      wordId: word.wordId,
      sourceText: word.sourceText,
      text: word.text,
      spokenStartsAtMs: word.startsAtMs,
      spokenEndsAtMs: word.endsAtMs,
      highlightStartsAtMs: word.startsAtMs,
      highlightEndsAtMs: word.endsAtMs,
      timingOrigin: word.timingOrigin
    }));
    const position = cuePlacement(plannedCue.speakerId, preset);
    const cue = {
      cueId: `visual-cue-${String(cueIndex + 1).padStart(6, "0")}`,
      sourceCueIds: plannedCue.sourceCueIds,
      speakerId: plannedCue.speakerId,
      spokenStartsAtMs: plannedCue.spokenStartsAtMs,
      spokenEndsAtMs: plannedCue.spokenEndsAtMs,
      displayStartsAtMs: words[0].highlightStartsAtMs,
      displayEndsAtMs: words.at(-1).highlightEndsAtMs,
      position,
      lineBreakBeforeWordIndexes: plannedCue.lineBreakBeforeWordIndexes,
      lineWidths: plannedCue.lineWidths,
      charactersPerSecond: plannedCue.charactersPerSecond,
      words
    };
    cue.plate = cuePlate(
      cue,
      speakerById.get(cue.speakerId)?.displayName ?? cue.speakerId,
      brand.showSpeakerNames,
      preset
    );
    return cue;
  });
  const visibleWords = cues.flatMap((cue) => cue.words);
  for (const [index, word] of visibleWords.entries()) {
    const nextStart = visibleWords[index + 1]?.highlightStartsAtMs ?? sceneEndMs;
    if (!Number.isSafeInteger(nextStart) || nextStart <= word.highlightStartsAtMs) {
      throw new CliError(`scene word ${word.wordId} has non-monotonic visible timing`);
    }
    word.highlightEndsAtMs = nextStart;
  }
  for (const cue of cues) {
    cue.displayStartsAtMs = cue.words[0].highlightStartsAtMs;
    cue.displayEndsAtMs = cue.words.at(-1).highlightEndsAtMs;
  }
  const readability = {
    schemaVersion: READABILITY_REPORT_SCHEMA,
    sourceWordCount: sourceWords.length,
    visibleWordCount: visibleWords.length,
    suppressedWordCount: sourceWords.length - visibleWords.length,
    sourceWordSequenceSha256: sha256(sourceWords.map(({ wordId }) => wordId)),
    visibleWordSequenceSha256: sha256(visibleWords.map(({ wordId }) => wordId)),
    punctuationOperations: punctuation.operations,
    capitalizationOperations: punctuation.capitalizationOperations,
    metrics: presentation.report
  };
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
      presentationPolicyVersion: TIMED_TEXT_PRESENTATION_POLICY_VERSION,
      punctuationPolicyVersion: PRESENTATION_PUNCTUATION_POLICY_VERSION,
      fontMetricsVersion: INTER_METRICS_VERSION,
      suppressFillers: true,
      holdUntilNextVisibleWord: true
    },
    layout: { ...preset },
    speakers,
    cues,
    readability
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
      || value.wordPresentation.presentationPolicyVersion !== TIMED_TEXT_PRESENTATION_POLICY_VERSION
      || value.wordPresentation.punctuationPolicyVersion !== PRESENTATION_PUNCTUATION_POLICY_VERSION
      || value.wordPresentation.fontMetricsVersion !== INTER_METRICS_VERSION
      || value.wordPresentation.suppressFillers !== true
      || value.wordPresentation.holdUntilNextVisibleWord !== true) {
    throw new CliError("scene word presentation policy is invalid");
  }
  if (!value.readability || typeof value.readability !== "object" || Array.isArray(value.readability)
      || Object.keys(value.readability).length !== READABILITY_KEYS.size
      || Object.keys(value.readability).some((key) => !READABILITY_KEYS.has(key))
      || value.readability.schemaVersion !== READABILITY_REPORT_SCHEMA
      || !Number.isSafeInteger(value.readability.sourceWordCount)
      || !Number.isSafeInteger(value.readability.visibleWordCount)
      || !Number.isSafeInteger(value.readability.suppressedWordCount)
      || value.readability.sourceWordCount < value.readability.visibleWordCount
      || value.readability.suppressedWordCount
        !== value.readability.sourceWordCount - value.readability.visibleWordCount
      || !/^[a-f0-9]{64}$/.test(value.readability.sourceWordSequenceSha256)
      || !/^[a-f0-9]{64}$/.test(value.readability.visibleWordSequenceSha256)
      || !Array.isArray(value.readability.punctuationOperations)
      || value.readability.punctuationOperations.length > value.readability.visibleWordCount
      || !Array.isArray(value.readability.capitalizationOperations)
      || value.readability.capitalizationOperations.length > value.readability.visibleWordCount
      || !value.readability.metrics || typeof value.readability.metrics !== "object"
      || Array.isArray(value.readability.metrics)
      || Object.keys(value.readability.metrics).length !== READABILITY_METRIC_KEYS.size
      || Object.keys(value.readability.metrics).some((key) => !READABILITY_METRIC_KEYS.has(key))) {
    throw new CliError("scene readability report is invalid");
  }
  const visibleWords = [];
  const speakerIdByWordId = new Map();
  for (const cue of value.cues) {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)
        || Object.keys(cue).length !== CUE_KEYS.size
        || Object.keys(cue).some((key) => !CUE_KEYS.has(key))
        || !/^visual-cue-[0-9]{6}$/.test(cue.cueId)
        || !Array.isArray(cue.sourceCueIds) || cue.sourceCueIds.length < 1
        || cue.sourceCueIds.some((cueId) => !/^cue_[0-9]{6}$/.test(cueId))
        || !speakerIDs.has(cue.speakerId)
        || !cue.position || typeof cue.position !== "object" || Array.isArray(cue.position)
        || Object.keys(cue.position).length !== POSITION_KEYS.size
        || Object.keys(cue.position).some((key) => !POSITION_KEYS.has(key))
        || cue.position.anchor !== 7
        || !Number.isSafeInteger(cue.position?.x) || cue.position.x < 0 || cue.position.x > value.layout.width
        || !Number.isSafeInteger(cue.position?.y) || cue.position.y < 0 || cue.position.y > value.layout.height
        || !cue.plate || typeof cue.plate !== "object" || Array.isArray(cue.plate)
        || Object.keys(cue.plate).length !== PLATE_KEYS.size
        || Object.keys(cue.plate).some((key) => !PLATE_KEYS.has(key))
        || ![cue.plate.x, cue.plate.y, cue.plate.width, cue.plate.height].every(Number.isSafeInteger)
        || cue.plate.x < 0 || cue.plate.y < 0 || cue.plate.width < 1 || cue.plate.height < 1
        || cue.plate.x + cue.plate.width > value.layout.width
        || cue.plate.y + cue.plate.height > value.layout.height
        || !Array.isArray(cue.lineBreakBeforeWordIndexes)
        || !Array.isArray(cue.lineWidths) || cue.lineWidths.length < 1
        || cue.lineWidths.length > value.layout.maximumDialogueLines
        || cue.lineBreakBeforeWordIndexes.length !== cue.lineWidths.length - 1
        || cue.lineWidths.some((width) => !Number.isSafeInteger(width) || width < 1)
        || !Number.isFinite(cue.charactersPerSecond) || cue.charactersPerSecond < 0
        || !Array.isArray(cue.words) || cue.words.length < 1) {
      throw new CliError("scene cue position is invalid");
    }
    let priorBreak = 0;
    for (const lineBreak of cue.lineBreakBeforeWordIndexes) {
      if (!Number.isSafeInteger(lineBreak) || lineBreak <= priorBreak || lineBreak >= cue.words.length) {
        throw new CliError("scene cue line breaks are invalid");
      }
      priorBreak = lineBreak;
    }
    const firstWord = cue.words[0];
    const lastWord = cue.words.at(-1);
    if (cue.spokenStartsAtMs !== firstWord.spokenStartsAtMs
        || cue.spokenEndsAtMs !== lastWord.spokenEndsAtMs
        || cue.displayStartsAtMs !== firstWord.highlightStartsAtMs
        || cue.displayEndsAtMs !== lastWord.highlightEndsAtMs
        || !Number.isSafeInteger(cue.spokenStartsAtMs)
        || !Number.isSafeInteger(cue.spokenEndsAtMs)
        || !Number.isSafeInteger(cue.displayStartsAtMs)
        || !Number.isSafeInteger(cue.displayEndsAtMs)
        || cue.spokenEndsAtMs <= cue.spokenStartsAtMs
        || cue.displayEndsAtMs <= cue.displayStartsAtMs) {
      throw new CliError("scene cue timing is inconsistent");
    }
    for (const word of cue.words) {
      if (!word || typeof word !== "object" || Array.isArray(word)
          || Object.keys(word).length !== PRESENTED_WORD_KEYS.size
          || Object.keys(word).some((key) => !PRESENTED_WORD_KEYS.has(key))
          || typeof word.wordId !== "string" || !word.wordId.startsWith("word_")
          || typeof word.sourceText !== "string" || !word.sourceText.trim()
          || typeof word.text !== "string" || !word.text.trim()
          || typeof word.timingOrigin !== "string" || !word.timingOrigin
          || !Number.isSafeInteger(word.spokenStartsAtMs)
          || !Number.isSafeInteger(word.spokenEndsAtMs)
          || !Number.isSafeInteger(word.highlightStartsAtMs)
          || !Number.isSafeInteger(word.highlightEndsAtMs)
          || word.spokenStartsAtMs < 0 || word.spokenEndsAtMs <= word.spokenStartsAtMs
          || word.highlightStartsAtMs !== word.spokenStartsAtMs
          || word.highlightEndsAtMs <= word.highlightStartsAtMs
          || word.spokenEndsAtMs > value.durationMs
          || word.highlightEndsAtMs > value.durationMs) {
        throw new CliError("scene word timing is invalid");
      }
      if (speakerIdByWordId.has(word.wordId)) {
        throw new CliError("scene contains a duplicate visible word");
      }
      speakerIdByWordId.set(word.wordId, cue.speakerId);
      visibleWords.push(word);
    }
  }
  for (const [index, word] of visibleWords.entries()) {
    const expectedEnd = visibleWords[index + 1]?.highlightStartsAtMs ?? value.durationMs;
    if (word.highlightEndsAtMs !== expectedEnd) {
      throw new CliError("scene visible-word hold timing is invalid");
    }
  }
  const operationByWordId = new Map();
  for (const operation of value.readability.punctuationOperations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)
        || Object.keys(operation).length !== PUNCTUATION_OPERATION_KEYS.size
        || Object.keys(operation).some((key) => !PUNCTUATION_OPERATION_KEYS.has(key))
        || !PUNCTUATION_MARKS.has(operation.mark)
        || !PUNCTUATION_REASONS.has(operation.reason)
        || operationByWordId.has(operation.afterWordId)) {
      throw new CliError("scene punctuation operation is invalid");
    }
    operationByWordId.set(operation.afterWordId, operation);
  }
  const capitalizationByWordId = new Map();
  for (const operation of value.readability.capitalizationOperations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)
        || Object.keys(operation).length !== CAPITALIZATION_OPERATION_KEYS.size
        || Object.keys(operation).some((key) => !CAPITALIZATION_OPERATION_KEYS.has(key))
        || operation.reason !== "sentence-start-capitalization"
        || !CAPITALIZATION_TRIGGERS.has(operation.trigger)
        || capitalizationByWordId.has(operation.wordId)) {
      throw new CliError("scene capitalization operation is invalid");
    }
    capitalizationByWordId.set(operation.wordId, operation);
  }
  for (const [index, word] of visibleWords.entries()) {
    const previous = visibleWords[index - 1];
    const currentWithSpeaker = { ...word, speakerId: speakerIdByWordId.get(word.wordId) };
    const previousWithSpeaker = previous
      ? { ...previous, speakerId: speakerIdByWordId.get(previous.wordId) }
      : null;
    const expectedTrigger = presentationCapitalizationTrigger(
      previousWithSpeaker,
      currentWithSpeaker
    );
    const capitalized = expectedTrigger ? capitalizeSentenceStart(word.sourceText) : word.sourceText;
    const capitalization = capitalizationByWordId.get(word.wordId);
    if ((capitalized !== word.sourceText) !== Boolean(capitalization)
        || (capitalization && capitalization.trigger !== expectedTrigger)) {
      throw new CliError("scene capitalization does not match sentence boundaries");
    }
    const punctuation = operationByWordId.get(word.wordId);
    const expectedText = punctuation ? `${capitalized}${punctuation.mark}` : capitalized;
    if (word.text !== expectedText) {
      throw new CliError("scene punctuation does not preserve source words");
    }
    operationByWordId.delete(word.wordId);
    capitalizationByWordId.delete(word.wordId);
  }
  if (operationByWordId.size > 0 || capitalizationByWordId.size > 0
      || value.readability.visibleWordCount !== visibleWords.length
      || value.readability.visibleWordSequenceSha256
        !== sha256(visibleWords.map(({ wordId }) => wordId))) {
    throw new CliError("scene readability word evidence is invalid");
  }
  const policy = presentationPolicy(value.aspect, value.layout);
  const metrics = value.readability.metrics;
  const maximumLines = Math.max(...value.cues.map((cue) => cue.lineWidths.length));
  const maximumLineWidth = Math.max(...value.cues.flatMap((cue) => cue.lineWidths));
  const maximumCharactersPerSecond = Math.max(...value.cues.map((cue) => cue.charactersPerSecond));
  const fastCueCount = value.cues.filter(
    (cue) => cue.charactersPerSecond > policy.fastReadingCharactersPerSecond
  ).length;
  const shortCueCount = value.cues.filter(
    (cue) => cue.spokenEndsAtMs - cue.spokenStartsAtMs < policy.shortCueWarningMs
  ).length;
  const overlongWordCount = value.cues.filter(
    (cue) => cue.lineWidths.some((width) => width > policy.maximumLineWidth)
  ).length;
  if (metrics.wordCount !== visibleWords.length || metrics.cueCount !== value.cues.length
      || metrics.maximumLines !== maximumLines || metrics.maximumLineWidth !== maximumLineWidth
      || metrics.maximumCharactersPerSecond !== maximumCharactersPerSecond
      || metrics.fastCueCount !== fastCueCount || metrics.shortCueCount !== shortCueCount
      || metrics.overlongWordCount !== overlongWordCount) {
    throw new CliError("scene readability metrics are inconsistent");
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
        cues: value.cues,
        readability: value.readability
      }).slice(0, 24)}`) {
    throw new CliError("scene hash does not match");
  }
  return value;
}
