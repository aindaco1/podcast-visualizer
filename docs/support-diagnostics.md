# Private support diagnostics

Podcast Visualizer keeps a small operational log on the Mac so a user can
export a report when a workflow failure cannot be reproduced by the developer.
Logging is local-only. **Report a Problem** shows a separately validated summary
for an explicit **Send Reviewed Reports** action. Opening review never sends.

## Recorded metadata

Each versioned event may contain only:

- app version and build;
- macOS version and CPU architecture;
- a random app-session identifier;
- an internal command label and workflow stage;
- command outcome, bounded duration, exit category, and an optional stable
  diagnostic code;
- for render commands only, the exact invocation's aspect (`16:9`, `1:1`,
  `9:16`, or `all`), background (`opaque`, `transparent`, or `both`), and
  alpha codec (`hevc`, `prores`, or `both`). These values come from the same
  typed render plan used to build the command, never from raw argument logging.
- a random command-attempt ID, actual helper exit status, safe JS/process/IO
  cause categories, and allowlisted reasons such as disk full or encoder failure;
- the last phase, actual output aspect/background/codec, output index/total,
  measured fraction and processed milliseconds. Phase/target transitions and
  at most one checkpoint per minute are persisted. Final failure retains the
  latest snapshot even after the helper emits `command.failed`.

New events use `podcast-visualizer-diagnostic-event-v2`. Exports still accept
legacy v1 events without render settings; settings cannot be recovered from
older reports. Unknown nested fields and values are rejected during export.
Settings are recorded on command start, completion, failure, and cancellation.
Command exit status and nested encoder exit status are distinct. Exit 0 followed
by invalid JSON is still logged as a result-decoding failure.
When rendering fails, the recorded stage is the failing `rendering` stage,
even though the UI returns to its preceding stage so the user can retry.

Safe render failure codes distinguish `render_runtime_failed`,
`render_alignment_failed`, `render_branding_failed`, `render_scene_failed`,
`render_staging_failed`, `render_encoding_failed`, `render_verification_failed`,
and a general `render_output_failed`. Messages name the operation, state what
was preserved, and supply a recovery step. Existing review/model/quality gates
keep their own exit categories.

The app does not write command arguments, file paths, source media, transcript
text, model inputs or outputs, review data, rendered outputs, tokenized review
URLs, or raw standard output/error to this log. Unexpected errors are converted
to a privacy-safe app failure instead of recording their description.

The app-owned `Podcast Visualizer/Diagnostics` Application Support directory is
mode `0700`. It retains at most two `0600` JSONL files of 1 MiB each. Writes and
exports reject symlinks and non-regular files. Imported log records are bounded,
schema-checked, and reject unexpected fields before export.

## User export

Choose **Export Diagnostic Log** in the app toolbar. The app creates a new
`podcast-visualizer-support-report-v1` JSON file at the location the user
chooses; it never replaces an existing report. The confirmation repeats the
excluded-data list and asks the user to review the JSON before sending it.

The exported report includes the retained events plus counts of dropped local
events or invalid records. Exporting does not modify a project, transcript,
render, or existing diagnostic history. If export fails, the app states what
was preserved and asks the user to choose a new writable location.

Exports may also include five recent macOS crash summaries. The reader scans
at most 20 matching app `.ips` filenames from the last 14 days, caps each at
2 MiB, rejects symlinks/non-regular files, and checks the exact bundle/process
identity. Only exception, signal, an allowlisted app/system image and relative
frame offset, and app/platform versions survive. Raw incidents, paths, symbols,
absolute addresses, other processes, and stacks are excluded. A missing OS
incident means no native crash summary is available.

## Reviewed issue submission

The app projects failures into `podcast-visualizer-issue-report-v1`; it never
uploads the exported log file. The review sheet shows the exact JSON to be sent.
Public fields use strict enums, numeric version strings, numeric bounds, and
random attempt/incident IDs. Expected cancellation/review/model/usage gates are
excluded. An older render without a terminal event is `interrupted_render`:
evidence of interruption, not proof of a crash. Current-session work is excluded.

Up to 20 reports form one review batch. Submission uses a fixed HTTPS endpoint,
an ephemeral cookie-free session, no redirects, a 15-second timeout, and limits
of 8 KiB per request and 4 KiB per response. Accepted receipts must match the
report ID and include a positive issue number. Offline, rejected, rate-limited,
or malformed responses retain pending reports. Successful IDs are recorded in
the bounded local log; all project data and local history remain available.

The shared relay lives in ASCII VJ Remix's `crash-relay/`. The dedicated route
`/v1/podcast-visualizer/reports` targets `aindaco1/podcast-visualizer`, leaving
the existing ASCII route intact. It validates every field again, rate-limits
intake, and reuses the GitHub App credentials and issue writer. One Durable
Object per fingerprint serializes provider calls and persists counts before
calling GitHub. It retains the last 1,000 successful IDs, at most 100 pending
IDs, and 32 version/platform buckets. Retries do not double-count within that
receipt window; local log rotation can eventually forget old receipts.

Workflow fingerprints use command, safe failure code, phase, cause/reason,
system/process outcome, architecture, and actual output codec/background.
Versions, durations, progress, IDs, and selected aspect do not split workflow
issues. Native offsets also group by build and OS because offsets change across
binaries. New occurrences update or reopen the indexed aggregate issue, rather
than appending comments. Counts are reports, not unique users. Generic symptoms
may group distinct root causes and still require triage.

## Release enablement

Version 1.3.1 enables submission in production app configuration. Debug builds
and other bundle identifiers remain unable to send. The relay was deployed
from ASCII commit `6750fb7`; live acceptance must pass before the app is
published. The [release record](releases/1.3.1.md) owns that evidence.
For subsequent deployments:

1. Give the relay's GitHub App installation Issues read/write access to
   `aindaco1/podcast-visualizer`; credentials remain server-side.
2. Deploy the reviewed ASCII relay changes and SQLite Durable Object migration
   through its manual workflow, then enable `PODCAST_REPORTS_ENABLED=true`.
3. As part of an authorized deployment, verify one synthetic report and
   its duplicate against a designated test issue. Never use user logs.
4. Set `PVSupportReportsEnabled` to boolean true in the production app's
   Info.plist before the normal signed build. Debug builds and other bundle
   identifiers cannot submit even with that flag.
5. Verify review, explicit Send, receipts, offline retry, and export in the
   signed installed candidate before publication.

Local tests and Worker dry-run bundling establish no deployment, live issue,
or signed-app acceptance. Disabling the relay preserves rendering, diagnostics,
and manual export. Cloudflare's [Durable Object lifecycle guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
describes the storage and external-await boundaries used by the relay.
