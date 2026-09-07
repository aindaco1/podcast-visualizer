# September 2026 render and split investigation

The supplied private reports contain 86 and 135 events; the larger report
includes the earlier history. Four unique version 1.3.0/build 23 renders failed
after 2,374–2,455 ms on macOS 26.6.2. Review approval and alignment completed.
The old export records only `failure`, with no render settings, stack trace,
or native editor actions. App restarts are visible but do not prove a specific
crash. Attachments were read locally and are not copied into this repository.

## Reproduced causes and fixes

- **Split crash:** `String.Index.utf16Offset(in:)` traps when a caret from the
  original cue is applied to a shortened cue. A caret after splitting whitespace
  can lie beyond the trimmed left text. The native selection wrapper checks the
  exact UTF-8 text snapshot, and the split action clears its selection before
  mutation. Tests cover retained selections, Unicode, split/merge, Undo/Redo,
  replacement, and preservation/recovery on an invalid split.
- **Render layout:** the shared presentation planner rejected explicit acoustic
  gaps above 10,000 ms, although valid aligned audio can contain longer pauses.
  Synthetic scene tests failed with the same class of unexpected error that the
  CLI redacts as “internal error.” `@dustwave/timed-text` 0.11.1 bounds gaps by
  the recording duration. Existing valid recordings within the earlier gap
  limit keep the same output and presentation policy identity. The customer's precise
  trigger remains unconfirmed without their project or more detailed diagnostics.
- **Render recovery:** the native workflow remained in `rendering` after a
  failure, leaving its next action unavailable. Failure/cancellation now restores
  the prior aligned/verified/exported stage and keeps prior output selections.
  The app test exercises two failed attempts without reopening and verifies both
  diagnostic records and the actionable failure message.
- **Diagnostics:** typed render invocations now supply allowlisted settings to
  v2 events on start and outcome. Legacy v1 events still export. Phase-specific
  error codes distinguish layout, encoding, verification, and other render work
  without recording private helper streams or paths.
  The subsequent audit adds command-attempt correlation, last target/progress,
  periodic checkpoints, actual process exit/signal and safe cause/reason fields,
  and bounded native macOS crash summaries. Explicit reviewed submission reuses
  the ASCII VJ Remix relay with separate repository routing and serialized
  duplicate aggregation. See [support diagnostics](../support-diagnostics.md)
  for privacy, grouping limits, and production-only release gates.
- **Overlap handling:** duplicate/nested turns previously counted the same
  speaker time multiple times, producing confidence as high as 2.8 in a test
  and concealing a tied overlap. Attribution now counts covered time once.
  Cue grouping also split only between known speakers, allowing ambiguous words
  to be absorbed into a dominant surrounding speaker. Unknown spans now have
  their own cue boundaries and remain unconfirmed for review.

## Quality limits and next evidence

The existing local sidecar runs Parakeet transcription and the shared Record
`OfflineSpeakerDiarizer`, using FluidAudio's offline defaults with optional
exact speaker count. The application receives one recognized word sequence and
anonymous speaker intervals. These fixes improve handling of supplied timing
and uncertainty; they cannot recover a second voice omitted by transcription.
Recognition-confidence tiers remain separate from speaker attribution.

No new model or threshold tuning is justified by these metadata-only reports.
Evaluate broader quality changes with a locally retained, manually labeled set
of clean turns, interruptions, simultaneous speech, and silence. Compare missed
words per speaker, wrong-speaker word assignments, and how much ambiguous speech
remains flagged. Keep single-speaker controls and source/model settings fixed.
If isolated speaker tracks are available, evaluate them separately from mixed
audio. Do not tune on a single anecdote or upload user recordings.

Existing immutable analyses are reused without reinterpreting saved review
edits. New cue-grouping behavior applies to newly analyzed projects; existing
projects can receive the render and native editor fixes without reanalysis.

## Validation and delivery boundaries

The new long-gap, duplicate-turn, and swallowed-overlap tests failed before the
fixes. The previous caret conversion was independently reproduced as a Swift
fatal bounds error. Local native tests exercise the shared selection wrapper
and rendered review layout; they do not constitute a signed installed-app
click-through on the reporting user's Mac.

`npm run test:render:smoke` passed with synthetic audio through the actual local
H.264, HEVC-alpha, and ProRes encoders, technical QC, decoded alpha checks, and
repeat-render reuse. No source podcast, transcript, or rendered user output was
altered. Full source-suite results are recorded in the task's final report.
The final local checks passed: 116 Swift tests, 187 source tests (three optional
checks skipped), 294 shared-platform tests, and 21 shared-relay tests. The source
check ran in a source-only copy with the same bundled runtime and a clean locked
fixture-alignment environment because iCloud had offloaded the original
development environment. Relay bundling passed `wrangler deploy --dry-run`.
The three source skips were the separately exercised long-pause encode smoke,
verification of an explicitly supplied optimized release-runtime path, and
installed alignment-model verification where that model was absent from the
isolated copy. These are distinct from the passing bundled Python/WhisperX
runtime verification.

The timed-text patch is in the existing shared-platform submodule. Review and
publish its commit before pinning it for a consumer release. Rolling back that
pointer also requires restoring the consumer lockfile's package version; it
restores the previous long-gap rejection. No signed release, update, hosted CI
run, or reporting-user acceptance is established by this local investigation.
