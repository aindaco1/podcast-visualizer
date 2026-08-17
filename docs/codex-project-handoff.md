# Codex project restart handoff

Last verified: 2026-08-17.

## Start here

Open this repository as the Codex project, read `AGENTS.md`, and preserve newer
user changes instead of resetting them. At the beginning of a fresh task run:

```bash
pwd
git status --short --branch
git submodule status --recursive
git log -5 --oneline --decorate
npm ci --ignore-scripts
npm run check
swift test --package-path macos --disable-automatic-resolution
```

The repository is public at
`https://github.com/aindaco1/podcast-visualizer`, uses the MIT license, and has
three pinned Git submodules. Initialize submodules recursively in a fresh clone;
do not casually advance them.

## Current product baseline

The source version is `1.1.1` on `release/1.1.1`; the current public release
remains `1.1.0` until the signed `v1.1.1` tag completes the protected release
workflow. Podcast Visualizer is an Apple Silicon SwiftUI
application for macOS 15+ wrapped around the existing local-first CLI. Swift is
the presentation and process-orchestration layer; the CLI remains authoritative
for transcription, alignment, scene policy, rendering, QC, and immutable
project manifests.

The implemented 1.0.1 scope and release gates are memorialized in
[`docs/releases/1.0.1-plan.md`](releases/1.0.1-plan.md). Work on the
`release/1.0.1` branch follows that document; performance and artifact evidence
are in [`docs/releases/1.0.1-performance.md`](releases/1.0.1-performance.md)
and [`docs/releases/1.0.1-size-audit.md`](releases/1.0.1-size-audit.md).
Version 1.0.2 is a narrow maintenance release that fixes Merge Next row
identity, prevents transcript reapproval teardown crashes, and moves the update
action to the top-right toolbar. Its release notes are in
[`docs/releases/1.0.2.md`](releases/1.0.2.md).
Version 1.0.3 restores the missing signed-release model setup path with an
in-app, verifier-backed importer whose app-owned storage survives updates. Its
release notes are in [`docs/releases/1.0.3.md`](releases/1.0.3.md).
Version 1.0.4 adds exact-path automatic model discovery, persistent read-only
search bookmarks, explicit pinned model downloads, and Node 24 GitHub Actions.
Its release notes are in [`docs/releases/1.0.4.md`](releases/1.0.4.md).
Version 1.0.5 removes the visible search-location
inventory, documents and verifies project-owned media imports, and isolates the
speech sidecar's progress protocol from dependency diagnostics. Its
release notes are in [`docs/releases/1.0.5.md`](releases/1.0.5.md).
Version 1.0.6 fixes legacy review-edit lineage, adds conservative post-approval
same-speaker line reflow, and optionally uses Apple's on-device Foundation
Models framework as a constrained line-boundary advisor. Its release notes are
in [`docs/releases/1.0.6.md`](releases/1.0.6.md).
Version 1.0.7 preserves find-field focus during Transcript Review search,
formats workflow stages for people, and stops after automatic alignment until
the user explicitly starts rendering. Its release notes are in
[`docs/releases/1.0.7.md`](releases/1.0.7.md).
Version 1.0.8 adds measured, punctuation-aware one/two-line video dialogue,
stable placement, contrast plates, hash-bound readability evidence, and an
advisory Xcode 27 compatibility lane while retaining stable macOS 15/Xcode 26.3
release gates. Its release notes are in
[`docs/releases/1.0.8.md`](releases/1.0.8.md), and the renderer contract is in
[`docs/renderer-readability-v1.md`](renderer-readability-v1.md).
Version 1.0.9 makes unchanged transcript reapproval idempotent, adds actionable
privacy-safe failure guidance, and records display-only
sentence-start capitalization after `.`, `?`, `!`, transcript starts, and
speaker changes without changing approved text or timing. Its release notes are
in [`docs/releases/1.0.9.md`](releases/1.0.9.md).
Version 1.1.0 increases dialogue type, moves the dialogue and plate to a
center-frame safe region, and versions the resulting scene/style identity. Its
release notes are in [`docs/releases/1.1.0.md`](releases/1.1.0.md).
Version 1.1.1 adds the standard Applications shortcut to the DMG, a direct
Apple Silicon download path, and one shared fail-closed layout contract used
during staging and mounted post-notarization verification. Its release notes
are in [`docs/releases/1.1.1.md`](releases/1.1.1.md).
The next planned visual addition is the local, audio-synchronized bottom
waveform described in [`ROADMAP.md`](../ROADMAP.md).

The app provides:

- project creation from local audio and validated reopening/resume;
- bounded progress, cancellation, corrective errors, and automatic continuation
  through stages that need no user decision;
- Parakeet transcription, anonymous diarization, optional expected-speaker
  count, approved-text alignment, and a mandatory human review gate;
- deterministic post-approval same-speaker dialogue reflow with optional,
  constrained on-device Foundation Models line-boundary advice;
- measured punctuation/pause-aware video dialogue derived from aligned words,
  with display-only high-confidence punctuation, sentence-start
  capitalization, and immutable readability evidence;
- a separate native Transcript Review tab before or after approval with audio
  playback, navigable literal find/replace, cue merge-next, global speaker
  merge, and manual speaker add, rename, and delete;
- podcast and organization names, a verified local PNG logo preview, and a
  rendered speaker-label toggle;
- 16:9, 1:1, and 9:16 output in opaque H.264/AAC, compact HEVC-alpha/AAC, and
  ProRes 4444/PCM;
- verified result rows, export copy, and Reveal in Finder;
- manual signed Sparkle updates from persistent top-right window chrome and
  GitHub Releases.

Models stay outside the app. Exact local models in app storage, Downloads, the
development checkout, or previously approved legacy folders can be discovered
and imported automatically. The search-path inventory is no longer exposed in
the Models card. Network downloads remain explicit, pinned, bounded, and
hash-verified. Media, transcripts, model inputs, and review data stay on the
Mac.

## Release architecture

Release builds pin Sparkle 2.9.5 and use the feed at:

```text
https://github.com/aindaco1/podcast-visualizer/releases/latest/download/appcast.xml
```

Automatic and background update checks are disabled. The main app has outbound
client access for explicit allowlisted model downloads; Sparkle's sandboxed
services own update networking. The appcast and update ZIP require the Podcast
Visualizer-specific Ed25519 key.

`.github/workflows/release.yml` validates an immutable signed semantic-version
tag, builds an arm64 app, imports the Developer ID certificate into an
ephemeral keychain, inventories and signs all nested Mach-O code inside-out,
notarizes and staples the app, creates and separately signs/notarizes/staples
the LZFSE DMG, generates a signed appcast plus a verified binary delta from the
prior public release,
enforces artifact-size budgets, verifies checksums, creates provenance, and
publishes the stable GitHub release. Version 1.1.1 uses the verified 1.1.0
archive as its binary-delta base.

The protected GitHub `release` environment is the CI credential boundary.
Offline credentials and private keys remain outside the repository. Never
print them, copy them into Git, add them to release artifacts, or disclose them
through build metadata. See [release-runbook.md](release-runbook.md).

## Required gates

Before any tag:

```bash
npm ci --ignore-scripts
npm audit --omit=dev --audit-level=high
npm run check
npm run test:coverage
swift test --package-path macos --disable-automatic-resolution
git diff --check
```

Also validate the exact assembled app outside a synced working tree, including
the complete Mach-O inventory, reviewed entitlements, Developer ID chain,
notarization ticket, Gatekeeper acceptance, DMG contents, signed appcast,
checksums, SBOM, and build metadata. Do not use `codesign --deep` as a signing
method, and never silently overwrite a generated stage or release artifact.

## Resume prompt

```text
Continue Podcast Visualizer from docs/codex-project-handoff.md. Work from the
open repository, read AGENTS.md and the linked release runbook first, preserve
all newer changes and immutable project outputs, keep user data local, add or
update tests for every behavioral change, and complete the requested work
through safe verification. Keep credentials out of Git and logs. Use the
existing CLI as the pipeline authority and the native SwiftUI app as its typed
presentation/orchestration layer.
```
