# Renderer readability policy v1

Podcast Visualizer 1.0.8 derives a visual presentation from the approved,
forced-aligned transcript without changing its editorial or acoustic evidence.
This document freezes the first readability policy so later renderer changes
can be reviewed and rolled back independently.

## Invariants

- Every visible word retains its source word ID, source cue lineage, acoustic
  start/end time, and timing origin.
- Conservative vocalized pauses remain in alignment evidence but may be
  omitted visually under `non-visual-fillers-hold-v1`.
- A highlight begins at the aligned word onset. Its visual hold may continue
  until the next visible word, while the separate spoken end remains intact.
- A visual cue never crosses a speaker change, explicit boundary, or acoustic
  gap longer than 900 ms.
- The renderer uses ASS/libass events and streams video directly to FFmpeg. It
  does not create an image sequence or send transcript/media data off the Mac.

## Layout and punctuation

`@dustwave/timed-text` policy `timed-text-presentation-v1` uses bundled Inter
glyph advances rather than character counts. A bounded dynamic-programming
window selects one- or two-line cues for each aspect ratio. It prefers, in
order, sentence endings (`.`, `?`, `!`), strong internal punctuation (`:`,
`;`, em dash, ellipsis), commas, and acoustic pauses. It penalizes function-word
breaks and avoidable one-word cues.

Reviewed punctuation is authoritative and preserved verbatim, including
quotation marks. `readability-punctuation-v2` may add display-only punctuation
in three high-confidence cases:

- an em dash between an immediately repeated same-speaker phrase;
- a comma between an emphatically repeated word such as “very, very”;
- commas around `like`, `you know`, `I mean`, or `sort of` only when at least
  180 ms of acoustic space exists on both sides.

These operations are tied to a source word ID in the readability report. They
never delete, reorder, replace, retime, or reassign a word. Repeated numbers,
speaker changes, and gaps over 900 ms disable repetition treatment. Ambiguous
punctuation is left to Transcript Review rather than guessed by a model.

The same display-only policy capitalizes a lowercase word at the start of the
transcript, a new speaker turn, or after a displayed period, question mark, or
exclamation point. It preserves existing capitals, acronyms, mixed-case names,
timing, and source text. Each case change is tied to its source word ID and
trigger in the readability report.

## Presentation and contrast

Dialogue stays at one center-frame anchor; speaker changes shift it vertically
by no more than 26 pixels. Transcript type is 108 px at 1920×1080, 96 px at
1080×1080, and 94 px at 1080×1920. Line planning reserves the plate padding
inside each aspect's safe width, and the centered plate is clamped to safe
margins on every side. A measured, translucent plate sits behind each cue.
Both bright and upcoming-word colors maintain at least 4.5:1 contrast against
the base background under the repository regression test.

Each immutable scene writes a sibling `*-readability.json` report containing
source/visible/suppressed counts, source and visible word-sequence hashes,
display-only punctuation and capitalization operations, maximum measured line
width, maximum lines, maximum characters per second, and counts for fast,
short, or overlong cues. Scene validation recomputes all visible metrics and
rejects unknown or inconsistent fields.

## Performance baseline

The pre-change scene builder processed a synthetic 10,000-word / 1,000-cue
episode in 72.25 ms with about 91 MB maximum resident memory. The complete v1
pipeline—font measurement, safe punctuation, bounded presentation planning,
plates, and report generation—processed the same input in 306.96 ms with about
156 MB maximum resident memory on the development Apple Silicon Mac.

The shared planner also has a 10,000-word regression contract requiring less
than five seconds; the release-candidate check completed in about 0.54 seconds.
The planner's candidate window is fixed (18 words in this app), so it does not
search the full transcript combinatorially. Caption planning remains negligible
relative to audio analysis and video encoding.

## Version and rollback boundary

The scene contract is `transcript-video-scene-v5`, style is `dust-branded-v4`,
renderer is `ass-scene-v7`, and report is `readability-report-v2`. Existing
scene and render artifacts are immutable. Changing any timing, grouping,
punctuation, metrics, placement, or visual policy requires a new version rather
than silently changing an existing render identity.
