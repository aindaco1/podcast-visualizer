import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPresentationPunctuation,
  PRESENTATION_PUNCTUATION_POLICY_VERSION
} from "../src/presentation-punctuation.js";

function words(texts, speakers = []) {
  return texts.map((text, index) => ({
    wordId: `word_fixture_${index}`,
    sourceText: text,
    text,
    startsAtMs: index * 300,
    endsAtMs: index * 300 + 220,
    speakerId: speakers[index] ?? "speaker-01",
    sourceCueId: "cue_000001",
    timingOrigin: "forced_alignment"
  }));
}

test("marks a repeated phrase as a same-speaker restart without deleting words", () => {
  const input = words(["I", "think", "I", "think", "we", "ship."]);
  const result = applyPresentationPunctuation(input);

  assert.equal(result.policyVersion, PRESENTATION_PUNCTUATION_POLICY_VERSION);
  assert.deepEqual(result.words.map(({ text }) => text), [
    "I", "think—", "I", "think", "we", "ship."
  ]);
  assert.deepEqual(result.words.map(({ sourceText }) => sourceText), input.map(({ sourceText }) => sourceText));
  assert.deepEqual(result.words.map(({ wordId }) => wordId), input.map(({ wordId }) => wordId));
  assert.deepEqual(result.operations, [{
    afterWordId: "word_fixture_1",
    mark: "—",
    reason: "same-speaker-restart"
  }]);
});

test("uses a comma for emphatic repetition and preserves existing punctuation", () => {
  assert.deepEqual(
    applyPresentationPunctuation(words(["very", "very", "clear."])).words.map(({ text }) => text),
    ["very,", "very", "clear."]
  );
  assert.deepEqual(
    applyPresentationPunctuation(words(["No,", "no", "thanks."])).words.map(({ text }) => text),
    ["No,", "no", "thanks."]
  );
});

test("does not infer a restart across speakers, long pauses, or repeated numbers", () => {
  const speakerChange = applyPresentationPunctuation(words(
    ["Right", "right"], ["speaker-01", "speaker-02"]
  ));
  assert.equal(speakerChange.operations.length, 0);

  const paused = words(["the", "the"]);
  paused[1].startsAtMs = 2_000;
  paused[1].endsAtMs = 2_200;
  assert.equal(applyPresentationPunctuation(paused).operations.length, 0);
  assert.equal(applyPresentationPunctuation(words(["2024", "2024"])).operations.length, 0);
});

test("commas only acoustically parenthetical discourse markers", () => {
  const parenthetical = words(["It", "was", "like", "a", "reset."]);
  parenthetical[2].startsAtMs = 900;
  parenthetical[2].endsAtMs = 1_100;
  parenthetical[3].startsAtMs = 1_400;
  parenthetical[3].endsAtMs = 1_620;
  parenthetical[4].startsAtMs = 1_700;
  parenthetical[4].endsAtMs = 1_920;
  const result = applyPresentationPunctuation(parenthetical);
  assert.deepEqual(result.words.map(({ text }) => text), ["It", "was,", "like,", "a", "reset."]);
  assert.deepEqual(result.operations.map(({ reason }) => reason), [
    "parenthetical-discourse-marker", "parenthetical-discourse-marker"
  ]);

  const semantic = words(["It", "was", "like", "a", "reset."]);
  assert.deepEqual(
    applyPresentationPunctuation(semantic).words.map(({ text }) => text),
    ["It", "was", "like", "a", "reset."]
  );
});

test("rejects unbounded, unsafe, or non-monotonic word evidence", () => {
  assert.throws(() => applyPresentationPunctuation([
    { ...words(["safe"])[0], sourceCueId: "../../cue" }
  ]), /word 1/);
  assert.throws(() => applyPresentationPunctuation([
    { ...words(["safe"])[0], text: "unsafe\u202e" }
  ]), /word 1/);
  const reversed = words(["first", "second"]);
  reversed[0].startsAtMs = 400;
  reversed[0].endsAtMs = 620;
  reversed[1].startsAtMs = 1;
  assert.throws(() => applyPresentationPunctuation(reversed), /word 2/);
});
