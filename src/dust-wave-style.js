export const DUST_WAVE_VISUAL_SYSTEM_VERSION = "dust-wave-transcript-v2";

// License-clean rendering tokens adapted from Dust Wave's existing ASCII VJ
// control-surface palette. Transcript colors remain speaker-specific.
export const DUST_WAVE_COLORS = Object.freeze({
  background: "#040506",
  paper: "#F7F7F4",
  muted: "#7F8795",
  cyan: "#00E5FF",
  magenta: "#FF2BD6"
});

export const DUST_WAVE_ASCII_GLYPHS = Object.freeze([
  ".", ":", "+", "*", "·", "'", "=", "~", "/", "\\"
]);

export const DUST_WAVE_ASCII_WAVES = Object.freeze([
  "· . : . + : : . · . : + . . : ·",
  ". : + = + : . . : + * + : . : .",
  "' . · : / / : · . + : | | : ."
]);
