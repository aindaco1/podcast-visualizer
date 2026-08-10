import assert from "node:assert/strict";
import test from "node:test";

import { INTER_METRICS_VERSION, measureInterText } from "../src/inter-metrics.js";

test("measures bundled Inter glyph advances deterministically", () => {
  assert.equal(INTER_METRICS_VERSION, "inter-regular-4.1-glyph-advance-v1");
  assert.equal(measureInterText("I", 92), 25);
  assert.equal(measureInterText("W", 92), 91);
  assert.ok(measureInterText("readable words", 92) > measureInterText("narrow", 92));
  assert.ok(measureInterText("what?", 92) > measureInterText("what.", 92));
});

test("uses bounded fallbacks and rejects unsafe measurement inputs", () => {
  assert.equal(measureInterText("界", 80), 80);
  assert.throws(() => measureInterText("text", 0), /invalid/);
  assert.throws(() => measureInterText(null, 80), /invalid/);
  assert.throws(() => measureInterText("x".repeat(2_001), 80), /invalid/);
  assert.throws(() => measureInterText("unsafe\u202e", 80), /invalid/);
});
