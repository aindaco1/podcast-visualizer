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
  assert.deepEqual(__test.renderAlphaCodecs("hevc"), ["hevc"]);
  assert.deepEqual(__test.renderAlphaCodecs("both"), ["hevc", "prores"]);
  assert.throws(() => __test.renderAlphaCodecs("webm"), /alpha-codec/);
});

test("plans alpha delivery tiers without duplicating opaque renders", () => {
  assert.deepEqual(
    __test.renderTargets(["opaque", "transparent"], ["hevc", "prores"]),
    [
      { background: "opaque", alphaCodec: null },
      { background: "transparent", alphaCodec: "hevc" },
      { background: "transparent", alphaCodec: "prores" }
    ]
  );
  assert.equal(
    __test.renderOutputRelativePath("render_123", "16:9", "transparent", "hevc"),
    "renders/render_123-16x9-transparent-hevc.mov"
  );
  assert.equal(
    __test.renderOutputRelativePath("render_123", "1:1", "transparent", "prores"),
    "renders/render_123-1x1-transparent-prores.mov"
  );
  assert.equal(
    __test.renderOutputRelativePath("render_123", "9:16", "opaque", null),
    "renders/render_123-9x16-opaque.mp4"
  );
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

test("parses chunked FFmpeg media-time progress monotonically", () => {
  const events = [];
  const parser = __test.createFFmpegProgressParser(10_000, (event) => events.push(event));
  parser.push(Buffer.from("out_time_us=2500000\nprogr"));
  parser.push(Buffer.from("ess=continue\nout_time=00:00:07.500000\nprogress=continue\n"));
  parser.push(Buffer.from("out_time_us=10000000\nprogress=end\n"));
  parser.finish();
  assert.deepEqual(events, [
    { fraction: 0.25, processedMs: 2500 },
    { fraction: 0.75, processedMs: 7500 },
    { fraction: 1, processedMs: 10_000 }
  ]);
});
