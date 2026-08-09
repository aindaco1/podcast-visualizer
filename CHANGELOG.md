# Changelog

All notable user-facing changes are documented here.

## 1.0.3 — 2026-08-08

- Added the missing in-app Models section so signed release builds can locate,
  verify, and import existing Parakeet and English alignment directories into
  persistent app-owned storage that survives Sparkle updates.

## 1.0.2 — 2026-08-08

- Fixed Transcript Review cue reconciliation so Merge Next preserves every
  later line and stale controls from a removed row cannot mutate another cue.
- Prevented a crash when approving an edited transcript by making retained row
  callbacks safe during review teardown.
- Moved Check for Updates to the top-right primary-action area of the toolbar.

## 1.0.1 — 2026-08-08

- Improved transcript drafts with conservative English year formatting,
  first-person capitalization, sentence capitalization, and deterministic
  source-word mappings while preserving raw Parakeet evidence.
- Rebalanced readable transcript cues to avoid preventable one-word tails
  without crossing hard timing, pause, or speaker boundaries.
- Added immutable post-approval transcript revisions so approved, aligned,
  rendered, or exported projects can return to Transcript Review without
  changing prior evidence or outputs.
- Added Previous/Next search navigation, visible match counts and selection,
  Replace This, Replace All, and Command-G/Shift-Command-G shortcuts.
- Defaulted new render selections to Landscape 16:9, Opaque H.264, and Compact
  HEVC Alpha while retaining square, vertical, and ProRes options.
- Moved Check for Updates to persistent top-left window chrome.
- Reduced the self-contained app and full update by shipping a verified
  alignment-only runtime, stripped release executables, LZFSE DMGs, and signed
  Sparkle deltas. No Homebrew or ambient runtime is required.
- Added signed-runtime manifest lineage, artifact-size budgets, optimized
  runtime smoke tests, and published delta/size provenance to the protected
  release workflow.

## 1.0.0 — 2026-08-08

- Added the native Apple Silicon macOS application and durable project reopen.
- Added bounded, accurate progress reporting for transcription and video work.
- Added a separate native transcript-review tab with audio playback, cue
  editing, merge-next, literal find/replace, speaker merge, add, rename, and
  delete. Deleting a speaker safely reassigns their cues to Unknown.
- Added an optional expected-speaker count to improve diarization.
- Added podcast and organization names, a verified PNG logo with preview, and
  optional speaker labels in rendered lines.
- Added automatic continuation whenever the next pipeline stage needs no user
  decision, while retaining transcript approval as a hard review gate.
- Added 16:9, 1:1, and 9:16 exports in opaque H.264, compact HEVC alpha, and
  ProRes 4444 alpha formats.
- Added Developer ID signing, Apple notarization and stapling, a signed Sparkle
  update feed, release checksums, SBOM, build metadata, and provenance.

## 0.1.0 release candidates

- Established the local-first CLI pipeline, anonymous diarization, mandatory
  transcript review, immutable project manifests, alignment, Dust Wave scene
  planning, and verified opaque and transparent rendering.
