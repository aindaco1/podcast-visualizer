import assert from "node:assert/strict";
import test from "node:test";

import {
  DUST_WAVE_COLORS, DUST_WAVE_FONT_NAMES, DUST_WAVE_SPEAKER_PALETTE,
  DUST_WAVE_VISUAL_SYSTEM_VERSION
} from "../src/dust-wave-style.js";

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
  const first = luminance(left);
  const second = luminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("keeps both highlighted and upcoming transcript words readable", () => {
  assert.equal(DUST_WAVE_VISUAL_SYSTEM_VERSION, "dust-wave-transcript-v3");
  assert.equal(DUST_WAVE_FONT_NAMES.transcript, "Inter");
  for (const speaker of DUST_WAVE_SPEAKER_PALETTE) {
    assert.ok(contrast(speaker.bright, DUST_WAVE_COLORS.background) >= 4.5, speaker.bright);
    assert.ok(contrast(speaker.dim, DUST_WAVE_COLORS.background) >= 4.5, speaker.dim);
  }
});
