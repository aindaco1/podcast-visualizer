export const WORD_PRESENTATION_POLICY_VERSION = "non-visual-fillers-hold-v1";

const FILLER_PATTERNS = Object.freeze([
  /^u+h+$/u,
  /^u+m+$/u,
  /^u+h+m+$/u,
  /^e+r+m*$/u,
  /^h+m+$/u,
  /^m{2,}$/u
]);

export function isNonVisualFiller(value) {
  const word = String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return word.length > 0 && FILLER_PATTERNS.some((pattern) => pattern.test(word));
}
