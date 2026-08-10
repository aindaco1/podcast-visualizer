export const PRESENTATION_PUNCTUATION_POLICY_VERSION = "readability-punctuation-v1";

const MAXIMUM_WORDS = 500_000;
const MAXIMUM_TEXT_LENGTH = 2_000;
const CONTROL_OR_BIDI = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const SAFE_WORD_ID = /^word_[a-z0-9_-]{1,118}$/u;
const SAFE_SPEAKER_ID = /^speaker-(?:0[1-9]|[1-9][0-9])$/u;
const SAFE_CUE_ID = /^cue_[0-9]{6}$/u;
const SAFE_TIMING_ORIGIN = /^[a-z][a-z0-9_-]{0,119}$/u;
const CORE_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const HAS_BOUNDARY_PUNCTUATION = /[,.;:!?—…]["'’”)\]]*$/u;
const EMPHATIC_REPETITIONS = new Set([
  "again", "many", "much", "never", "no", "really", "so", "very", "way", "yes"
]);
const MAXIMUM_REPEAT_WORDS = 4;
const MAXIMUM_REPEAT_GAP_MS = 900;
const PARENTHETICAL_GAP_MS = 180;
const PARENTHETICAL_PHRASES = Object.freeze([
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["like"]
]);

export function applyPresentationPunctuation(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_WORDS) {
    throw new TypeError("Presentation punctuation words are invalid");
  }
  let previousStart = -1;
  const words = value.map((word, index) => {
    const normalized = validateWord(word, index, previousStart);
    previousStart = normalized.startsAtMs;
    return normalized;
  });
  const operations = [];
  for (let index = 0; index < words.length - 1;) {
    const length = repeatedPhraseLength(words, index);
    if (length === 0) {
      index += 1;
      continue;
    }
    const targetIndex = index + length - 1;
    const target = words[targetIndex];
    if (!HAS_BOUNDARY_PUNCTUATION.test(target.text)) {
      const mark = length === 1 && EMPHATIC_REPETITIONS.has(core(target.text)) ? "," : "—";
      target.text = `${target.text}${mark}`;
      operations.push({
        afterWordId: target.wordId,
        mark,
        reason: mark === "," ? "emphatic-repetition" : "same-speaker-restart"
      });
    }
    index += length * 2;
  }
  markParentheticalDiscourse(words, operations);
  return {
    policyVersion: PRESENTATION_PUNCTUATION_POLICY_VERSION,
    words,
    operations
  };
}

function markParentheticalDiscourse(words, operations) {
  const operated = new Set(operations.map(({ afterWordId }) => afterWordId));
  for (let index = 1; index < words.length - 1; index += 1) {
    for (const phrase of PARENTHETICAL_PHRASES) {
      const end = index + phrase.length - 1;
      if (end >= words.length - 1
          || words[index - 1].speakerId !== words[index].speakerId
          || words[end].speakerId !== words[end + 1].speakerId
          || phrase.some((word, offset) => core(words[index + offset].text) !== word)) {
        continue;
      }
      const gapBeforeMs = words[index].startsAtMs - words[index - 1].endsAtMs;
      const gapAfterMs = words[end + 1].startsAtMs - words[end].endsAtMs;
      if (gapBeforeMs < PARENTHETICAL_GAP_MS || gapAfterMs < PARENTHETICAL_GAP_MS) continue;
      for (const targetIndex of [index - 1, end]) {
        const target = words[targetIndex];
        if (operated.has(target.wordId) || HAS_BOUNDARY_PUNCTUATION.test(target.text)) continue;
        target.text = `${target.text},`;
        operations.push({
          afterWordId: target.wordId,
          mark: ",",
          reason: "parenthetical-discourse-marker"
        });
        operated.add(target.wordId);
      }
      index = end;
      break;
    }
  }
}

function validateWord(value, index, previousStart) {
  const allowed = new Set([
    "wordId", "sourceText", "text", "startsAtMs", "endsAtMs", "speakerId",
    "sourceCueId", "timingOrigin"
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.has(key))
      || typeof value.wordId !== "string" || !SAFE_WORD_ID.test(value.wordId)
      || !safeText(value.sourceText) || !safeText(value.text)
      || !Number.isSafeInteger(value.startsAtMs) || !Number.isSafeInteger(value.endsAtMs)
      || value.startsAtMs < 0 || value.startsAtMs < previousStart
      || value.endsAtMs <= value.startsAtMs
      || typeof value.speakerId !== "string" || !SAFE_SPEAKER_ID.test(value.speakerId)
      || typeof value.sourceCueId !== "string" || !SAFE_CUE_ID.test(value.sourceCueId)
      || typeof value.timingOrigin !== "string" || !SAFE_TIMING_ORIGIN.test(value.timingOrigin)) {
    throw new TypeError(`Presentation punctuation word ${index + 1} is invalid`);
  }
  return { ...value };
}

function safeText(value) {
  return typeof value === "string" && value.length <= MAXIMUM_TEXT_LENGTH
    && value === value.normalize("NFC").trim() && value.length > 0
    && !CONTROL_OR_BIDI.test(value);
}

function repeatedPhraseLength(words, start) {
  const remaining = words.length - start;
  for (let length = Math.min(MAXIMUM_REPEAT_WORDS, Math.floor(remaining / 2)); length >= 1; length -= 1) {
    const secondStart = start + length;
    if (words[start].speakerId !== words[secondStart].speakerId
        || words[secondStart].startsAtMs - words[secondStart - 1].endsAtMs > MAXIMUM_REPEAT_GAP_MS) {
      continue;
    }
    let matches = true;
    for (let offset = 0; offset < length; offset += 1) {
      const left = words[start + offset];
      const right = words[secondStart + offset];
      if (left.speakerId !== right.speakerId || core(left.text) !== core(right.text)
          || !core(left.text)) {
        matches = false;
        break;
      }
    }
    if (matches && (length > 1 || !/^\d+$/u.test(core(words[start].text)))) return length;
  }
  return 0;
}

function core(value) {
  return [...String(value).toLocaleLowerCase("en-US").matchAll(CORE_WORD)]
    .map((match) => match[0])
    .join(" ");
}
