import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "../src/render.js";

test("validates exact render stream evidence", () => {
  const scene = { durationMs: 5000, frameRate: 24, layout: { width: 1920, height: 1080 } };
  const probe = {
    durationMs: 5000, width: 1920, height: 1080, frameRate: 24, frameCount: 120,
    videoCodec: "h264", pixelFormat: "yuv420p", colorSpace: "bt709",
    colorTransfer: "bt709", colorPrimaries: "bt709", audioCodec: "aac",
    sampleRate: 48000, channels: 2
  };
  assert.deepEqual(__test.validateProbe(probe, scene), {
    passed: true, failures: [], expectedFrames: 120, durationDeltaMs: 0
  });
  const invalid = __test.validateProbe({ ...probe, width: 1080, frameRate: 30, durationMs: 5200 }, scene);
  assert.equal(invalid.passed, false);
  assert.deepEqual(invalid.failures.slice(0, 3), ["dimensions", "frame-rate", "duration"]);
});

test("parses ffprobe rational frame rates safely", () => {
  assert.equal(__test.rational("24/1"), 24);
  assert.equal(__test.rational("24000/1000"), 24);
  assert.ok(Number.isNaN(__test.rational("24/0")));
});
