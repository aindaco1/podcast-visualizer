# Smart transcript reflow

Podcast Visualizer restructures dialogue during transcript approval without
changing the approved words or inventing speaker identity.

## Authority and fallback

1. FluidAudio acoustic diarization and the reviewer's confirmed assignment are
   the authority for speaker changes.
2. `@dustwave/timed-text` performs a deterministic O(n) reflow of adjacent
   same-speaker cues. Speaker changes, pauses over 900 ms, ten-second cue spans,
   22-word cues, and 140-character cues are hard boundaries.
3. On macOS 26 or newer, and only when Apple Intelligence's on-device model is
   available, the app may ask it to classify existing candidate boundaries as
   `merge` or `keep`.
4. If the model is unavailable or fails, approval falls back to deterministic
   reflow. Cancelling cancels approval; completed review edits and immutable
   revisions are preserved.

Parakeet remains the automatic speech-recognition engine. It supplies words and
draft timing; it is not an instruction-following language model and is not used
for semantic reflow.

## Privacy and trust boundaries

- The app uses Apple's system language model on device. It sends no transcript,
  audio, review data, or model input to a project server or third-party API.
- Prompts contain only bounded adjacent text excerpts, stable cue IDs, the
  anonymous speaker label, and the measured gap. Each excerpt is capped at 320
  characters, each request at 24 boundaries, and an approval at 120 evenly
  sampled candidates.
- Generated IDs and actions are treated as untrusted. The app retains only one
  known action for a supplied candidate ID, and the CLI validates the exact
  version-five edit shape again. Recognition confidence is a separate derived
  signal and never changes this merge/keep authority.
- A semantic `merge` remains advisory. The shared engine will not cross a
  confirmed speaker change or any timing/readability hard limit. A `keep`
  decision can only preserve a boundary.
- The semantic pass cannot rewrite text, manufacture timestamps, rename or add
  speakers, or infer a real-world identity.

## Performance and rollback

The deterministic pass is linear and tested at the 10,000-cue contract limit.
Manual split/merge operations use the same word-preserving native editing
contract before approval. A merged confidence tier is the most conservative
contributing tier; reflow never upgrades weak recognition evidence.
The on-device pass is capped at five 24-boundary batches and samples across a
long transcript rather than concentrating only at its beginning. The prior
`lightly-cleaned-verbatim-v1` editorial policy and older native edit
contract remain valid, so rollback is an independent application/submodule
pin change rather than a transcript migration.
