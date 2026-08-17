# Changelog

All notable user-facing changes are documented here.

## Unreleased

## 1.2.0 — 2026-08-17

- Added review-gated topic and question chapters generated with Apple's
  on-device Foundation Models framework from bounded approved transcript text.
  The model may choose only verified alignment anchors and never creates
  timestamps or sends podcast data off the Mac.
- Added manual chapter editing plus immutable YouTube, Markdown, and JSON
  exports. Approval enforces the `00:00` opening, minimum count, spacing, final
  duration, safe titles, and exact source evidence.
- Added shared linear timed-text chapter planning, strict JavaScript and Swift
  contracts, private atomic working copies, content-addressed revisions,
  preservation-focused failure messages, and a 10,000-cue performance gate.
- Selectively adapted product concepts from Craig Mod's MIT-licensed
  `youtube-timestamps` while retaining the existing offline transcription,
  alignment, shared timed-text, and preferred native model stack.
- Fixed the automatic transition into Transcript Review and the new Chapters
  actions by keeping subcommand progress identities consistent with the native
  app contract. Protocol failures now explain that existing media and completed
  stages were preserved and how to resume safely.
- Chapter generation now detects when grounded transcript anchors cannot form a
  valid three-chapter plan before invoking the on-device model, preserving any
  draft and explaining that a longer or more separated clip is required.
- Added visible elapsed progress for local alignment and bounded window progress
  for both topic- and question-style on-device chapter generation, including a
  cancellation control that preserves the existing chapter draft.
- On-device chapter generation now retries an incomplete structured model
  response or declined transcript window once in smaller bounded batches,
  preserving valid partial results without looping. Runtime schema constraints
  limit every model selection to a supplied local anchor. Remaining model
  failures provide privacy-safe, actionable recovery guidance and confirm the
  existing draft was preserved.

## 1.1.2 — 2026-08-17

- Corrected final DMG verification so it checks the mounted app structure,
  signatures, notarization tickets, and Gatekeeper result without launching a
  sandbox-inheriting helper outside its signed parent application.
- Retains the 1.1.1 installation improvements; 1.1.1 failed closed before
  publication, so 1.1.0 remains the binary-delta base for this release.

## 1.1.1 — 2026-08-17

- Added a standard Applications shortcut to the signed DMG for a clear
  drag-to-install flow and compatibility with cautious single-app DMG handlers.
- Added fail-closed DMG layout checks during packaging and mounted-image
  verification after signing, notarization, and stapling. Release validation
  now checks image integrity, the exact top-level layout, the installed app's
  bundle contract, signatures, notarization tickets, and Gatekeeper result.
- Added a direct Apple Silicon DMG link while retaining the full release page
  for checksums, SBOM, notarization evidence, and provenance.

## 1.1.0 — 2026-08-10

- Increased dialogue type across every output aspect and moved cues to a stable
  center-frame anchor. Measured line planning and centered contrast plates stay
  inside aspect-specific safe margins without changing transcript or timing.

## 1.0.9 — 2026-08-10

- Made approval of an unchanged active transcript an idempotent success while
  preserving immutable revision files and the active pointer.
- Capitalized display-only sentence starts after periods, question marks, and
  exclamation points, as well as transcript and speaker-turn starts. Approved
  source text, acronyms, mixed-case names, alignment, and timing remain
  unchanged, and every case operation is recorded in readability evidence.
- Replaced opaque unexpected transcript save/approval failures with
  privacy-safe preservation and recovery guidance.

## 1.0.8 — 2026-08-10

- Rebuilt video dialogue presentation around measured Inter glyph advances,
  punctuation, syntax, acoustic pauses, and hard speaker boundaries. Visual
  cues now use at most two lines in one stable reading area instead of jumping
  around the frame.
- Added display-only comma and em-dash treatment for high-confidence acoustic
  parentheticals, emphatic repetition, and same-speaker restarts. Every source
  word and forced-alignment timestamp remains unchanged, and reviewed colons,
  semicolons, quotation marks, exclamation points, question marks, ellipses,
  and other punctuation guide layout directly.
- Added per-cue contrast plates, WCAG-style palette regression coverage, and a
  hash-bound readability report with line-width, reading-speed, short-cue,
  overlong-word, suppression, and punctuation evidence.
- Added stable macOS 15/Xcode 26.3 release gates plus an advisory Xcode 27 CI
  lane and a documented macOS 27 response procedure. No speculative OS,
  entitlement, or deployment-target changes were introduced.

## 1.0.7 — 2026-08-09

- Fixed Transcript Review search so navigating or highlighting a match does
  not move keyboard focus into a transcript cue and overwrite its text when
  the user resumes typing a query.
- Replaced raw workflow-stage identifiers with stable, human-readable labels,
  including **Review Required**.
- Changed post-approval orchestration to align automatically and then wait for
  the user to explicitly start rendering with their selected outputs.

## 1.0.6 — 2026-08-09

- Fixed Transcript Review Save and Approve for legacy projects whose edit
  lineage has no base transcript revision.
- Added a deterministic post-approval reflow that joins short adjacent lines
  from the same acoustic speaker without changing words or crossing timing,
  duration, or readability limits.
- Added an optional on-device Apple Foundation Models boundary advisor on
  supported Macs. It may only recommend joining or keeping eligible adjacent
  lines; unavailable or invalid model output falls back to the deterministic
  local policy.
- Advanced the native review-edit contract to version 4 while retaining
  version 3 and older-revision compatibility.

## 1.0.5 — 2026-08-09

- Removed the model search-location inventory and folder-management controls
  from the Models card while retaining automatic app-storage and Downloads
  discovery plus explicit verified import and download actions.
- Clarified that source media and saved podcast logos are copied into the
  project, retained source access until each copy completes, and added
  regression coverage proving projects remain usable after originals are
  deleted.
- Isolated speech progress on a dedicated inherited descriptor so FluidAudio
  diagnostics cannot corrupt measured transcription progress, rejected missing
  or non-finite progress safely, and made release builds compile the sidecar
  from the reviewed tagged source.

## 1.0.4 — 2026-08-08

- Added automatic, exact-path model discovery in app storage, Downloads, the
  development checkout, and up to eight user-approved read-only folders.
- Added user-initiated Parakeet and English alignment downloads with pinned
  HTTPS sources, bounded streaming progress, SHA-256 verification, existing
  model verification, cancellation cleanup, and atomic installation.
- Replaced raw missing-model diagnostics with clearer setup actions, source,
  size, and license information.
- Updated checkout, Node setup, and uv setup to immutable Node 24 action pins;
  retained uv's prior cache-pruning behavior explicitly.

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
