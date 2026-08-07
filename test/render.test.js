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

test("validates compact HEVC and ProRes 4444 alpha overlay stream evidence", () => {
  const scene = {
    aspect: "9:16", durationMs: 5000, frameRate: 24,
    layout: { width: 1080, height: 1920, bitrate: "14M" }
  };
  const hevcProbe = {
    durationMs: 5000, width: 1080, height: 1920, frameRate: 24, frameCount: 120,
    videoCodec: "hevc", videoProfile: "Main", videoCodecTag: "hvc1",
    pixelFormat: "yuv420p", colorSpace: "bt709", colorTransfer: "bt709",
    colorPrimaries: "bt709", audioCodec: "aac", sampleRate: 48000, channels: 2
  };
  assert.equal(__test.validateProbe(hevcProbe, scene, "transparent", "hevc").passed, true);
  assert.equal(__test.codecFor("transparent", scene).alphaCodec, "hevc");
  const probe = {
    durationMs: 5000, width: 1080, height: 1920, frameRate: 24, frameCount: 120,
    videoCodec: "prores", videoProfile: "4444", videoCodecTag: "ap4h",
    pixelFormat: "yuva444p12le", colorSpace: "bt709", colorTransfer: "bt709",
    colorPrimaries: "bt709", audioCodec: "pcm_s24le", sampleRate: 48000, channels: 2
  };
  assert.equal(__test.validateProbe(probe, scene, "transparent", "prores").passed, true);
  assert.equal(__test.validateProbe({ ...probe, pixelFormat: "yuv444p10le" }, scene, "transparent", "prores").passed, false);
  assert.deepEqual(__test.renderBackgrounds("both"), ["opaque", "transparent"]);
  assert.throws(() => __test.renderBackgrounds("green"), /background/);
  assert.equal(__test.codecFor("transparent", scene, "prores").alphaMode, "straight");
  assert.equal(__test.renderAlphaCodec("hevc"), "hevc");
  assert.throws(() => __test.renderAlphaCodec("webm"), /alpha-codec/);
});

test("parses ffprobe rational frame rates safely", () => {
  assert.equal(__test.rational("24/1"), 24);
  assert.equal(__test.rational("24000/1000"), 24);
  assert.ok(Number.isNaN(__test.rational("24/0")));
});

test("plans representative JPEG QC frames for visual inspection", () => {
  const scene = {
    durationMs: 5000,
    title: { endsAtMs: 1000 },
    speakers: [{ id: "speaker-01" }, { id: "speaker-02" }],
    cues: [
      {
        speakerId: "speaker-01", startsAtMs: 1000, endsAtMs: 2600,
        words: [{ startsAtMs: 1100, endsAtMs: 1500 }, { startsAtMs: 1600, endsAtMs: 1700 }]
      },
      {
        speakerId: "speaker-02", startsAtMs: 2800, endsAtMs: 4500,
        words: [{ startsAtMs: 2900, endsAtMs: 3300 }]
      }
    ]
  };
  const frames = __test.qcFrameTimes(scene);
  assert.deepEqual(frames.map(({ label }) => label), [
    "title", "speaker-01", "speaker-02", "longest-cue", "fastest-word", "cue-transition", "final"
  ]);
  assert.ok(frames.every(({ milliseconds }) => milliseconds >= 0 && milliseconds < scene.durationMs));
});
