# CLI contract for the macOS app

The native app invokes the packaged `dustwave-video` launcher with argument
arrays. It does not construct shell commands or parse human-readable output.

## Final results and errors

Every app invocation includes `--json`. Successful final results remain on
standard output and retain the existing per-command shapes. Error results are
one JSON object on standard error using
`podcast-visualizer-error-v1`; the process exit status remains authoritative.
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
reinitializes or overwrites the selected directory.

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

The native Transcript Review tab uses three noninteractive review actions:

- `review load --project DIRECTORY --json` returns a
  `podcast-visualizer-review-workspace-v3` object containing absolute local
  project/audio paths, the draft identity, stable anonymous speaker IDs with
  editable display names, and the latest validated working-copy cues.
- `review save --project DIRECTORY --input FILE --json` accepts a bounded
  `podcast-visualizer-review-edit-v4` file and atomically replaces only the
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
Version-four edits may include bounded `merge` or `keep` hints for existing
adjacent cue IDs. The shared reflow engine validates those hints and never lets
them bypass speaker, pause, duration, word-count, or character-count limits.
Older version-three edits remain readable with no semantic hints.

Approval always runs deterministic linear same-speaker cue reflow. On macOS 26
or newer, the native app may first ask Apple's on-device system language model
to classify a bounded, evenly sampled set of existing same-speaker boundaries.
Model output is untrusted: unknown IDs, duplicate IDs, and unknown actions are
dropped before the version-four edit is written. The model never edits words,
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
