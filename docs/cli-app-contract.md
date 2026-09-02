# CLI contract for the macOS app

The native app invokes the packaged `dustwave-video` launcher with argument
arrays. It does not construct shell commands or parse human-readable output.

## Final results and errors

Every app invocation includes `--json`. Successful final results remain on
standard output and retain the existing per-command shapes. Error results are
one JSON object on standard error using
`podcast-visualizer-error-v1`; the process exit status remains authoritative.
Unexpected internal failures remain redacted, but their message and hint must be
specific to the requested operation, state which existing project evidence was
preserved, and give the user a concrete retry or reporting step. Every bug fix
must add regression coverage for both the behavior and its user-facing failure
contract.
Known failures may add a bounded lowercase `diagnosticCode` to the error object.
It identifies a specific safe failure condition without including paths or user
content; the exit status and broader `code` category remain unchanged. The
native app may retain that code in its local support log, but it never logs the
error message, hint, command arguments, stdout, or stderr. See
[`support-diagnostics.md`](support-diagnostics.md).
Representative results for every app command are frozen under
`test/fixtures/cli-contract/v1/`.

`probe --source FILE --json` returns a
`podcast-visualizer-media-probe-v1` object with the canonical absolute source
path, bounded byte size, exact duration in milliseconds, and the first audio
stream's codec, sample rate, and channel count. The app uses that duration to
construct an explicit full-file or ranged `init --clip` argument.

`status --project DIRECTORY --json` validates the project manifest and copied
source, rejects unsafe stage markers, and returns the latest resumable stage.
The app uses this read-only command for **Open Existing Project…** and never
reinitializes or overwrites the selected directory. Approved, aligned, and
verified projects also return a bounded `transcript` summary derived from the
validated active revision: word count, cue count, speakers used by that
revision, and the subset with non-default reviewed display names. Earlier stages return
`transcript: null`.

Project-specific branding uses two bounded actions:

- `branding load --project DIRECTORY --json` returns the podcast name,
  organization name, speaker-name visibility, and an optional verified local
  PNG logo with preview dimensions.
- `branding save --project DIRECTORY --input FILE --json` atomically replaces
  only `branding/settings.json`. A replacement logo is copied to a new
  hash-named immutable project asset; old logo assets and renders are preserved.

Names are NFC-normalized and limited to 120 characters. Logos must be regular,
non-symlink PNG files between 128 and 4096 pixels and no larger than 10 MiB;
1024 × 1024 is the recommended source size.

`review --project DIRECTORY --no-open --json` never opens a browser itself.
It returns the tokenized loopback URL through the progress stream as soon as
the server is listening, then returns the same URL and the immutable approval
identity in the final JSON result. The URL contains a per-launch secret and
must not be persisted or logged.

Browser and native approval results share the same transcript summary shape.
Stable `speaker-NN` IDs remain anonymous acoustic clusters; the summary calls a
speaker recognized only when review has replaced its default `Speaker N`
display name. This distinction affects presentation only and does not alter
speaker IDs, transcript content, timing, or immutable revision evidence.

The native Transcript Review tab uses three noninteractive review actions:

- `review load --project DIRECTORY --json` returns a
  `podcast-visualizer-review-workspace-v4` object containing absolute local
  project/audio paths, the draft identity, stable anonymous speaker IDs with
  editable display names, the latest validated working-copy cues, derived
  recognition-confidence evidence, Checked cue IDs, and derived Edited cue IDs.
- `review save --project DIRECTORY --input FILE --json` accepts a bounded
  `podcast-visualizer-review-edit-v5` file and atomically replaces only the
  mutable `review/working.json` copy.
- `review approve --project DIRECTORY --input FILE --json` validates the same
  edit contract and creates a new immutable approved transcript revision.

Edit inputs must be absolute, non-symlink regular files no larger than 2 MiB.
The CLI rejects unknown fields, a non-canonical draft hash, unsafe cue timing,
and manual speaker identities outside the anonymous `speaker-01` through
`speaker-99` range. Speaker display names are normalized, limited to 60
characters, and stored separately from those stable IDs. Version-one edit and
working-copy files remain readable and receive default `Speaker N` labels.
The loopback browser editor uses the same working-copy validator and restores
saved changes on reopen. Deleting a speaker is also a working-copy edit: its
cues become unconfirmed `unknown` assignments until the reviewer reassigns
them. Approved speaker display names can be shown above every rendered cue.
Version-four and version-five edits may include bounded `merge` or `keep` hints for existing
adjacent cue IDs. The shared reflow engine validates those hints and never lets
them bypass speaker, pause, duration, word-count, or character-count limits.
Older version-three edits remain readable with no semantic hints.

Version-five edits add `checkedCueIds`. The CLI accepts only unique canonical
IDs belonging to submitted cues and stores them in mutable
`podcast-visualizer-review-working-v4` copies. Checked state resets when a new
edit begins from an approved revision and never enters approved transcript
content or hashes. Workspace `editedCueIds` are rederived against the immutable
draft and cannot be supplied by a UI.

Recognition confidence uses local immutable Parakeet token evidence and the
shared `parakeet-spoken-token-minimum-v1` policy. The workspace contains one
bounded tier record per cue; token text is never included. The native UI shows
tiers only, not the internal score. Missing or legacy evidence yields
Unavailable. Confidence is excluded from editable input, approval, alignment,
and rendering, so a client cannot forge it.

The native Chapters tab uses four noninteractive, local-first actions after
alignment:

- `chapters load` returns a bounded context tied to the active approved
  transcript and exact pinned alignment, plus the current context-specific
  working copy and approval.
- `chapters save --input FILE` atomically saves an explicit
  `podcast-visualizer-chapter-edit-v1` working copy.
- `chapters approve --input FILE` resolves supplied anchor IDs to immutable
  alignment timestamps and writes a content-addressed approval.
- `chapters export --format youtube|markdown|json` creates or verifies an
  immutable export for the active approval.

Topic and question modes use distinct context identities and drafts. The CLI
rejects unknown fields, stale contexts, symlinks, traversal, invented or
duplicate anchors, unsafe titles, non-canonical hashes, and altered evidence.
Approval requires three or more chapters, a first timestamp of `00:00`, at
least ten seconds between starts, and ten seconds after the final start.

On macOS 26 or newer, Apple's on-device language model may propose a supplied
anchor ID, concise title, and exact evidence quote from each bounded window.
The app treats that response as untrusted and drops unknown IDs, duplicates,
unsafe titles, ungrounded evidence, and invalid spacing. The deterministic
shared timed-text package remains the sole timestamp compiler; no transcript
or model input leaves the Mac.

Approval always runs deterministic linear same-speaker cue reflow. On macOS 26
or newer, the native app may first ask Apple's on-device system language model
to classify a bounded, evenly sampled set of existing same-speaker boundaries.
Model output is untrusted: unknown IDs, duplicate IDs, and unknown actions are
dropped before the version-five edit is written. The model never edits words,
assigns speakers, accesses media, or blocks approval when unavailable. No
transcript or model input leaves the Mac.

`analyze` accepts optional `--expected-speakers 1...6`. When present, the
offline diarizer uses an exact speaker-count constraint; when absent it retains
the automatic one-through-six range. This model limit does not cap speakers
added manually during transcript review. Existing immutable analysis results
are never silently replaced when this option changes.

The native app chains stages that require no new decision. After project
creation it prepares, analyzes, and opens Transcript Review. After transcript
approval it aligns and renders the already-selected outputs. Source/project
selection, transcript approval, and completed-project rerenders remain explicit.

## Progress stream

Long-running app invocations include `--progress-fd 3`. Descriptor 3 is a
dedicated writable pipe and must not alias standard input, output, or error.
The CLI writes bounded newline-delimited JSON events using
`podcast-visualizer-progress-v1`; final JSON never appears on this descriptor.
Each event is at most 8 KiB and contains a monotonically increasing sequence,
the command, an event name, and a bounded detail object.

The currently stable lifecycle events are:

- `command.started`
- `analysis.progress`, with a named `phase` and an optional measured
  `fraction` from `0...1`
- `render.progress`, with a named `phase`, optional measured `fraction`,
  processed media milliseconds, output index/count, aspect, and delivery
  profile
- `review.ready`, including `reviewUrl` and `state: review_required`
- `command.completed`
- `command.failed`, including the stable error code, message, and optional hint

Determinate speech percentages describe the audio pass currently exposed by
FluidAudio: transcription or diarization scanning. Model loading, speaker
clustering, and result writing intentionally omit `fraction`. Render encoding
uses FFmpeg's processed media timestamp divided by the scene duration;
technical verification intentionally omits `fraction`. Clients must show an
indeterminate indicator when the field is absent rather than inventing stage
weights or elapsed-time estimates as completion percentages.

Consumers must reject unsupported progress schema versions, enforce their own
bounded line buffer, tolerate unknown event names from a supported schema,
and use the final process status plus JSON result to determine completion.

## External model root

Release app builds keep imported external models in Podcast Visualizer's
sandboxed Application Support container. The in-app Models section is the
supported release path for selecting, verifying, and copying an existing model
directory there. A development app assembled at
`.build/macos-app/Podcast Visualizer.app` may reuse an existing verified
`models/parakeet-tdt-0.6b-v3` installation at the repository root. This
compatibility lookup is exact and does not scan the home directory; app-owned
models take precedence, and symlinked model roots are rejected.

## Brand resource

`resources/brand/dust-wave-v1.json` is the neutral, versioned source for app
and renderer colors, font names, speaker colors, and ASCII tokens. JavaScript
validates and consumes it at startup. Swift bundles and validates the same
file; it does not copy these values into source literals.
