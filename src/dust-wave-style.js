import fs from "node:fs";

import { CliError } from "./errors.js";

export const BRAND_SCHEMA = "podcast-visualizer-brand-v1";
export const BRAND_RESOURCE = new URL("../resources/brand/dust-wave-v1.json", import.meta.url);

const COLOR = /^#[A-F0-9]{6}$/;
const SPEAKER_TOKEN = /^dust-[a-z]+(?:-[a-z]+)*$/;

function loadBrandTokens() {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(BRAND_RESOURCE, "utf8"));
  } catch {
    throw new CliError("Dust Wave brand tokens could not be read");
  }
  const topLevel = new Set(["schemaVersion", "visualSystemVersion", "fonts", "colors", "speakers", "ascii"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !topLevel.has(key))
      || value.schemaVersion !== BRAND_SCHEMA
      || typeof value.visualSystemVersion !== "string" || !value.visualSystemVersion
      || !value.fonts || typeof value.fonts.transcript !== "string" || typeof value.fonts.label !== "string"
      || !value.colors || !["background", "paper", "muted", "cyan", "magenta"].every((key) => COLOR.test(value.colors[key]))
      || !Array.isArray(value.speakers) || value.speakers.length !== 6
      || value.speakers.some((speaker) => !SPEAKER_TOKEN.test(speaker?.token)
        || !COLOR.test(speaker?.bright) || !COLOR.test(speaker?.dim))
      || !Array.isArray(value.ascii?.glyphs) || value.ascii.glyphs.length < 1
      || value.ascii.glyphs.some((glyph) => typeof glyph !== "string" || !glyph || glyph.length > 2)
      || !Array.isArray(value.ascii?.waves) || value.ascii.waves.length < 1
      || value.ascii.waves.some((wave) => typeof wave !== "string" || !wave || wave.length > 120)) {
    throw new CliError("Dust Wave brand tokens are invalid");
  }
  return Object.freeze(value);
}

export const DUST_WAVE_BRAND = loadBrandTokens();
export const DUST_WAVE_VISUAL_SYSTEM_VERSION = DUST_WAVE_BRAND.visualSystemVersion;
export const DUST_WAVE_COLORS = Object.freeze({ ...DUST_WAVE_BRAND.colors });
export const DUST_WAVE_FONT_NAMES = Object.freeze({ ...DUST_WAVE_BRAND.fonts });
export const DUST_WAVE_SPEAKER_PALETTE = Object.freeze(
  DUST_WAVE_BRAND.speakers.map((speaker) => Object.freeze({ ...speaker }))
);
export const DUST_WAVE_ASCII_GLYPHS = Object.freeze([...DUST_WAVE_BRAND.ascii.glyphs]);
export const DUST_WAVE_ASCII_WAVES = Object.freeze([...DUST_WAVE_BRAND.ascii.waves]);
