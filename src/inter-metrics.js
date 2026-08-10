export const INTER_METRICS_VERSION = "inter-regular-4.1-glyph-advance-v1";

const UNITS_PER_EM = 2048;
const FALLBACK_ADVANCE = 1200;
const WIDE_FALLBACK_ADVANCE = 2048;
const MAXIMUM_TEXT_LENGTH = 2_000;
const CONTROL_OR_BIDI = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const ADVANCES = new Map();

function register(characters, widths) {
  [...characters].forEach((character, index) => ADVANCES.set(character, widths[index]));
}

register(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  [
    1413, 1340, 1496, 1478, 1231, 1209, 1528, 1522, 550, 1169, 1376, 1158,
    1850, 1543, 1566, 1308, 1566, 1318, 1314, 1322, 1524, 1413, 2018, 1397,
    1390, 1288
  ]
);
register(
  "abcdefghijklmnopqrstuvwxyz",
  [
    1150, 1254, 1170, 1254, 1194, 758, 1256, 1211, 496, 496, 1124, 496, 1794,
    1210, 1228, 1254, 1254, 771, 1081, 670, 1211, 1151, 1676, 1118, 1151, 1131
  ]
);
register("0123456789", [1292, 833, 1249, 1265, 1323, 1215, 1270, 1159, 1267, 1270]);
for (const [character, width] of [
  [" ", 576], [",", 590], [".", 590], [":", 590], [";", 618], ["!", 589],
  ["?", 1047], ["—", 2048], ["…", 1770], ["“", 902], ["”", 902], ["‘", 534],
  ["’", 534], ["\"", 903], ["'", 534], ["(", 747], [")", 747], ["-", 942],
  ["[", 747], ["]", 747], ["/", 930], ["\\", 930], ["&", 1500], ["+", 1200],
  ["=", 1200], ["%", 1850], ["$", 1200], ["#", 1350], ["@", 1900]
]) ADVANCES.set(character, width);

export function measureInterText(value, fontSize) {
  if (typeof value !== "string" || value.length > MAXIMUM_TEXT_LENGTH
      || CONTROL_OR_BIDI.test(value) || !Number.isFinite(fontSize)
      || fontSize <= 0 || fontSize > 1_000) {
    throw new TypeError("Inter text measurement input is invalid");
  }
  let units = 0;
  for (const character of value.normalize("NFC")) {
    if (/\p{M}/u.test(character)) continue;
    const codePoint = character.codePointAt(0);
    units += ADVANCES.get(character)
      ?? (codePoint >= 0x2e80 ? WIDE_FALLBACK_ADVANCE : FALLBACK_ADVANCE);
  }
  return Math.max(1, Math.ceil(units / UNITS_PER_EM * fontSize));
}
