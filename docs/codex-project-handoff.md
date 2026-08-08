# Codex project restart handoff

Audience: the next Codex task implementing the native macOS application.

Last verified: 2026-08-07.

## Start here

Open this exact folder as the Codex project before creating the new task:

```text
/Users/aindaco1/Library/Mobile Documents/com~apple~CloudDocs/podcast-visualizer
```

Opening the repository as the project is important. A task rooted elsewhere
may be able to read this iCloud folder but will not receive ordinary
workspace-write access to it. Changing Unix permissions or creating a symlink
does not alter that Codex sandbox boundary.

At the beginning of the task:

```bash
pwd
git status --short --branch
git submodule status --recursive
git log -5 --oneline --decorate
npm ci --ignore-scripts
npm run check
```

The expected repository path is the one above, the expected branch is `main`,
and the expected handoff commit or a descendant is
`2f9d0723249c5a536f8325aca3e4f329424e0390`. Preserve any newer user changes
instead of resetting them. Read `AGENTS.md` before editing, plus:

- [macOS app release-candidate plan](macos-app-rc-plan.md)
- [implementation plan](implementation-plan.md)
- [release checklist](release-checklist.md)
- [editor compatibility](editor-compatibility.md)

## Paste this into the new task

```text
Continue Podcast Visualizer from docs/codex-project-handoff.md. Work from the
open podcast-visualizer project folder and read AGENTS.md and the linked plans
first. Build the planned bare-bones native SwiftUI macOS app through a genuine
0.2.0 release candidate: finish the missing CLI-to-app contracts, add the
Swift package and tests, integrate the existing bundled CLI without
reimplementing pipeline policy, add all aspect/opaque/HEVC-alpha/ProRes-alpha
exports, add manual signed Sparkle updates, then sign, notarize, package, and
verify the candidate using the existing Apple Auth material. Keep media and
models local, keep credentials out of Git and logs, preserve immutable project
outputs, add tests with every contract change, and run the security,
performance, packaging, and release gates. Reuse the Record release/update
patterns and shared Dust Wave packages where applicable. Commit and push
coherent slices to the public GitHub repository. Continue autonomously unless
a genuinely irreversible product decision or unavailable external credential
blocks the work; do not repeatedly ask for ordinary file-edit permission.
```

## Current verified baseline

- Repository: `https://github.com/aindaco1/podcast-visualizer`
- Visibility/license: public, MIT.
- Baseline before this handoff: clean `main` at `2f9d072`.
- Published CLI candidate: `v0.1.0-rc.3`; `package.json` remains
  `0.1.0-rc.3`.
- Latest post-tag change: explicit HEVC/ProRes alpha delivery tiers and this
  macOS plan. No `0.2.0` tag or native app release exists yet.
- CI run `31215609430` passed for `2f9d072`.
- Local gates passed: 82 Node tests, 34 Swift tests, coverage collection,
  syntax and secret scans, locked Python/runtime validation, real H.264,
  HEVC-alpha, and ProRes-alpha smoke encodes, and a zero-vulnerability
  production dependency audit.
- The repository contains three pinned Git submodules: Dust Wave Platform,
  the alignment runner, and Record. Initialize recursively in a fresh clone;
  do not casually advance their pinned revisions.

The existing CLI already provides:

- Parakeet transcription, anonymous speaker diarization, and reviewed-text
  alignment.
- A mandatory local human transcript/speaker review gate.
- Non-visual filler handling that retains `uh`/`um` in timing evidence while
  holding the last visible word.
- Dust Wave typography, speaker colors, and deterministic ASCII motion.
- 16:9, 1:1, and 9:16 rendering.
- Opaque H.264/AAC, compact HEVC-alpha/AAC, and ProRes 4444/PCM delivery.
- `--alpha-codec hevc|prores|both`, including one opaque plus both alpha tiers
  without duplicate opaque work.
- Bundled Node, FFmpeg, Python/alignment, speech, font, review, license, and
  runtime assets; model weights remain external and verified.

The native macOS app is now implemented and assembled during development at
`.build/macos-app/Podcast Visualizer.app`. It has typed CLI contracts, bounded
progress, cancellation, model-root handling, output selection, and a separate
native Transcript Review tab. The review tab edits local working copies,
provides local audio playback, global anonymous-speaker merge, literal
find/replace, cue merge-next, adding manual speakers through `speaker-99`,
speaker deletion with cue reassignment to Unknown, reviewer-authored speaker
display names, save, and immutable approval; the tokenized loopback browser UI
remains available as a fallback with the same speaker metadata. Project-local
branding persists podcast and organization names, an optional verified PNG
logo, and rendered speaker-name visibility. The app can open and validate an
existing project directory and restore its latest resumable stage. It now
automatically chains prepare/analyze into review and approval into
alignment/render. Speech analysis also exposes an optional exact
expected-speaker count to reduce diarizer over-splitting. The development app
bundle uses the supplied mint waveform/transcript icon.

## Fixed product and security decisions

- Target `0.2.0-rc.1` as a small Apple-Silicon SwiftUI wrapper around the
  existing CLI. Swift is presentation and process orchestration only.
- Direct Developer ID distribution; no Mac App Store work in this candidate.
- Use `com.aindaco.podcast-visualizer` unless a signing or bundle-identifier
  collision is discovered.
- Use one restrained window. The first candidate may launch the existing
  loopback transcript-review UI in the browser rather than rewriting it.
- HEVC alpha is the compact default. ProRes 4444 is the large compatibility
  option. Expose all three aspect ratios and all three delivery profiles.
- Keep models outside the application bundle. Model downloads are explicit,
  never automatic.
- Use Sparkle 2 with a manually invoked **Check for Updates…** command.
  Automatic/background checks remain off.
- Use the public stable feed at
  `https://github.com/aindaco1/podcast-visualizer/releases/latest/download/appcast.xml`.
  Test prerelease replacement with a tag-specific signed RC feed; do not mark
  an RC stable merely to make GitHub's `latest` redirect select it.
- Create a dedicated Podcast Visualizer Sparkle Ed25519 key. Do not reuse
  Record's private update key.
- The main app gets no general network client/server entitlement. Sparkle's
  sandboxed services own update networking.
- No telemetry, accounts, uploads, cloud transcription, implicit model
  downloads, or source-media logging.

## Credential boundary

The offline credential source is:

```text
/Users/aindaco1/Library/Mobile Documents/com~apple~CloudDocs/Apple Auth
```

Use exact, user-controlled credential paths or Keychain/environment inputs.
Never search this directory heuristically, print credential contents, copy it
into the repository, or commit private keys, certificate passwords, P8 files,
issuer/key IDs, notarization material, or the Sparkle private key. Temporary
credential files and keychains must use restrictive permissions and be removed
on both success and failure. The protected GitHub `release` environment is the
CI secret boundary.

## Next implementation sequence

The detailed acceptance criteria live in the macOS plan. The next task should
execute these slices in order and keep each slice independently testable.

### 1. Finish app-facing CLI contracts

Already complete: dual alpha selection and explicit codec filenames.

Still required:

- Add full-file initialization or a stable JSON media-probe contract.
- Add a versioned, bounded newline-delimited JSON progress stream on a
  dedicated descriptor while preserving final `--json` output.
- Add a noninteractive review-server mode that returns the loopback URL and
  completion state without opening a browser.
- Freeze representative JSON success/error fixtures for every command Swift
  invokes.
- Extract neutral, versioned Dust Wave brand tokens consumable by JavaScript
  and Swift.

Do not parse human CLI prose and do not introduce shell command construction.

### 2. Build the native shell against a fake CLI

- Add the proposed `macos/` Swift package with app and core targets.
- Implement the state reducer, typed JSON contracts, argument-array command
  builder, streamed output, cancellation, resume, and immutable export policy.
- Build the one-window SwiftUI interface and deterministic fake-CLI tests.
- Keep process execution behind a narrow protocol so tests need no media,
  models, or network.

### 3. Integrate the packaged CLI

- Explicitly assemble `Podcast Visualizer.app`; do not present `swift build`
  output as an application bundle.
- Include exactly one verified runtime closure and all notices/resources.
- Complete one real prepare-to-render project through the UI without ambient
  Homebrew, Node, Python, or FFmpeg.
- Preserve project manifests as the source of truth and resume safely after
  relaunch or failure.

### 4. Complete output and UX gates

- Exercise every aspect/profile combination, export copy, Finder reveal,
  storage warnings, and collision behavior.
- Validate VoiceOver, keyboard use, contrast, and Reduce Motion.
- Verify alpha and audio sync in representative supported editors according
  to the compatibility guide.

### 5. Sign, notarize, update, and publish the candidate

- Reuse Record's reviewed Sparkle `2.9.5`, appcast, temporary-keychain,
  Developer ID, notarization, and release workflow patterns where still
  applicable.
- Inventory and sign every nested Mach-O inside-out. The bundle contains more
  executable code than Record, including Node, Python, FFmpeg/FFprobe, and
  speech sidecars. Never use `codesign --deep` as the signing method.
- Notarize the signed app, staple it, then create and Sparkle-sign the final
  ZIP. Separately sign, notarize, staple, and assess the DMG.
- Publish the DMG, Sparkle ZIP, signed appcast, checksums, metadata, SBOM,
  notices, and provenance from an immutable signed tag.
- Test previous-candidate replacement, relaunch, and same-version behavior on
  a clean Apple-Silicon account.

## Required recurring gates

Run these after relevant slices and before tagging:

```bash
npm run check
npm run test:coverage
npm audit --omit=dev --audit-level=high
git diff --check
```

Also run `swift build` and `swift test` once the Swift package exists, the
locked alignment-runner lint/tests when its boundary changes, the packaged
runtime smoke suite, bundle/SBOM/symlink/Mach-O inventory checks, signature and
entitlement verification, notarization validation, Gatekeeper assessment,
and the signed update replacement test. Keep CI green after every pushed
slice.

The full 62-minute 16:9 soak render is deferred only for CLI `0.1.0-rc.3`; it
remains required before a final non-candidate release and should be budgeted
before promoting the native application beyond release-candidate status.

## Definition of handoff completion

The next task is complete only when a clean Apple-Silicon account can install
the notarized candidate, import or locate verified external models, import
audio, review and approve transcript/speakers, render and export every promised
delivery type, relaunch/resume safely, and perform a manually initiated signed
update. A planning-only Swift skeleton is not a release candidate.
