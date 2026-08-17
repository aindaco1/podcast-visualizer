# Local chapter generation v1

Podcast Visualizer 1.2.0 adds review-gated episode chapters without creating a
second transcription or alignment system. It selectively adapts the useful
product ideas from Craig Mod's MIT-licensed
[`youtube-timestamps`](https://github.com/cmod/youtube-timestamps): topic and
question modes, word-accurate snapping, inexpensive re-analysis, and YouTube,
Markdown, and JSON output. Media acquisition, hosted transcription, and hosted
LLM providers are intentionally not adopted.

## Data flow

1. The active immutable approved transcript and its exact compatible WhisperX
   result are revalidated locally.
2. `@dustwave/timed-text/chapters` projects reviewed cues onto verified first
   word anchors and divides them into deterministic bounded windows.
3. Apple's Foundation Models framework may choose supplied anchor IDs and
   propose grounded titles on supported Macs. Transcript strings are quoted as
   untrusted data. Nothing is uploaded.
4. The app drops unknown or duplicate IDs, ungrounded evidence, unsafe titles,
   too-close boundaries, and a final chapter shorter than ten seconds.
5. The user edits, saves, and explicitly approves the result. Only the shared
   timed-text package converts approved anchor IDs back into exact timestamps.
6. Export writes a new immutable YouTube text, Markdown table, or JSON file.

The language model is advisory. It never generates timestamps, edits the
transcript, identifies speakers, or bypasses the shared deterministic policy.
If Foundation Models is unavailable or returns fewer than three grounded
chapters, the editor remains usable for manual selection.

## Local artifacts

Chapter data stays below the project root:

- `chapters/contexts/chapter_context_<digest>.json` is an immutable projection
  bound to the project, audio, transcript revision, alignment revision, mode,
  and shared policy.
- `chapters/working/<context-id>.json` is the explicit mutable working copy.
  Separate context IDs preserve drafts made against older transcript or
  alignment revisions.
- `chapters/revisions/chapters_<digest>-approved.json` is immutable reviewed
  evidence. `active-topics.json` and `active-questions.json` are narrow atomic
  pointers.
- `chapters/exports/chapters_<digest>.*` contains immutable derived output.

Existing files are never silently replaced. Repeating an identical generated
stage verifies its exact canonical content; a collision with different content
fails closed. Working copies and active pointers are replaced only by explicit
Save or Approve actions and use private atomic temporary files.

## CLI contracts

```text
dustwave-video chapters load --project DIR --mode topics|questions --json
dustwave-video chapters save --project DIR --input FILE --mode topics|questions --json
dustwave-video chapters approve --project DIR --input FILE --mode topics|questions --json
dustwave-video chapters export --project DIR --mode topics|questions \
  --format youtube|markdown|json --json
```

The edit file uses `podcast-visualizer-chapter-edit-v1` and contains only the
current context identity plus `{anchorId,title}` entries. Unknown fields,
non-canonical hashes, unsafe or symlinked paths, stale contexts, invented
anchors, duplicate anchors, Unicode control/bidirectional overrides, unbounded
titles, and invalid timing are rejected at both the JavaScript and Swift
boundaries.

YouTube validity is enforced at approval: at least three chapters, the first at
`00:00`, ten seconds or more between starts, and at least ten seconds after the
final start. Timestamps use floor-to-second formatting of alignment evidence;
they are never rounded from model output.

## Performance and evaluation gates

The shared planner is a bounded linear pass. Its regression test processes
10,000 cues in under two seconds; the development baseline is currently under
60 ms on the release machine. Each model window is capped at 80 cues, 8,000
characters, and six minutes. The complete native context is capped below the
app's four-megabyte subprocess output limit.

Release evaluation covers:

- deterministic window and anchor identity;
- exact timestamp formatting for short and hour-plus episodes;
- invented, duplicate, unsafe, too-close, stale, and tampered inputs;
- immutable save/approval/export behavior and private file permissions;
- topic/question CLI argument arrays and frozen success/error contracts;
- model-output grounding and native approval gates;
- 10,000-cue planning performance.

Before expanding model policy, evaluate a local, rights-cleared set of short,
long, multi-speaker, topic, and Q&A episodes. Compare boundary precision,
title usefulness, invalid-output rejection, edit distance after generation,
and total review time. Do not weaken deterministic validation to improve a
model-only score.
