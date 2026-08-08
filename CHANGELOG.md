# Changelog

All notable user-facing changes are documented here.

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
