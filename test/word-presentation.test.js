import assert from "node:assert/strict";
import test from "node:test";

import {
  isNonVisualFiller, WORD_PRESENTATION_POLICY_VERSION
} from "../src/word-presentation.js";

test("suppresses conservative vocalized pauses with a versioned policy", () => {
  assert.equal(WORD_PRESENTATION_POLICY_VERSION, "non-visual-fillers-hold-v1");
  for (const word of ["uh", "UHH", "um", "ummm", "uhm", "er", "erm", "hmm", "hm", "mm", "mmm"]) {
    assert.equal(isNonVisualFiller(word), true, word);
  }
});

test("keeps semantic discourse and affirmation words visible", () => {
  for (const word of ["uh-huh", "huh", "ah", "like", "you", "know", "I", "mean", "umbrella"]) {
    assert.equal(isNonVisualFiller(word), false, word);
  }
});
