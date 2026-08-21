# Private support diagnostics

Podcast Visualizer keeps a small operational log on the Mac so a user can
export a report when a workflow failure cannot be reproduced by the developer.
Logging is local-only and never sends a report automatically.

## Recorded metadata

Each versioned event may contain only:

- app version and build;
- macOS version and CPU architecture;
- a random app-session identifier;
- an internal command label and workflow stage;
- command outcome, bounded duration, exit category, and an optional stable
  diagnostic code.

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
