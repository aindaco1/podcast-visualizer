import assert from "node:assert/strict";
import test from "node:test";

import { parseClip, parseClock } from "../src/time.js";

test("parses minute and hour clocks", () => {
  assert.equal(parseClock("01:58"), 118000);
  assert.equal(parseClock("1:02:03.250"), 3723250);
});

test("parses the accepted proof clip", () => {
  assert.deepEqual(parseClip("00:01:58-00:03:25"), {
    startsAtMs: 118000,
    endsAtMs: 205000,
    durationMs: 87000
  });
});

test("rejects malformed and reversed clips", () => {
  assert.throws(() => parseClock("61:00"));
  assert.throws(() => parseClip("00:03:25-00:01:58"));
  assert.throws(() => parseClip("not-a-clip"));
});

