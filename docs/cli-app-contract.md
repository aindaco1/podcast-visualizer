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

`review --project DIRECTORY --no-open --json` never opens a browser itself.
It returns the tokenized loopback URL through the progress stream as soon as
the server is listening, then returns the same URL and the immutable approval
identity in the final JSON result. The URL contains a per-launch secret and
must not be persisted or logged.

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

Release app builds keep imported external models under
`~/Library/Application Support/Podcast Visualizer/Models`. A development app
assembled at `.build/macos-app/Podcast Visualizer.app` may reuse an existing
verified `models/parakeet-tdt-0.6b-v3` installation at the repository root.
This compatibility lookup is exact and does not scan the home directory;
app-owned models take precedence, and symlinked model roots are rejected.

## Brand resource

`resources/brand/dust-wave-v1.json` is the neutral, versioned source for app
and renderer colors, font names, speaker colors, and ASCII tokens. JavaScript
validates and consumes it at startup. Swift bundles and validates the same
file; it does not copy these values into source literals.
