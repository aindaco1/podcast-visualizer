# 0.1 release-candidate checklist

## Automated gates

- [x] `npm ci --ignore-scripts` from a clean clone
- [x] `npm audit --omit=dev --audit-level=high`
- [x] `npm run check`
- [x] `npm run test:coverage`
- [x] RecordSpeech PR checks green at the pinned revision
- [x] alignment-runner `ruff` and `pytest` green with the locked environment
- [x] `dustwave-video doctor` passes after external model import
- [x] release archive expands without absolute or escaping symbolic links
- [x] packaged launcher works without Homebrew, Node, Python, FFmpeg, or `uv`
- [x] SBOM, third-party notices, component manifests, and archive SHA-256 present

Evidence captured 2026-08-07:

- Main CI run `31195897928` passed at `8ee0d2ffcd865d9b0d81abe6aea27e8ae33854f8`, including recursive checkout, clean `npm ci`, audit, 57 Node tests with coverage, and 27 locked alignment-runner tests.
- Record PR 42 passed workflow/shell lint, Swift arm64 tests, Swift sanitizer tests, and dependency review at pinned revision `33f8996b4c059637aefbeb49ea2411cdfad816d2`.
- The source-tree doctor passed with `PATH=/usr/bin:/bin` after importing both external models.
- The archive builder extracted and inspected 31,499 files plus eight contained relative symlinks, then ran the archived launcher and doctor without developer runtimes.
- The pre-release archive at commit `966289d` was 389,990,537 bytes with SHA-256 `31951f84153c7e4943f9cec62c07ad78f5ca897e651a20c95c856845aa0f8224`; the published archive will be rebuilt from the final tagged commit.

## Proof gates

- [x] Approved source excerpt acquired outside the product and excluded from Git
- [x] 87-second audio prepared and hashed
- [x] Parakeet produced a timestamped English draft
- [x] anonymous diarization detected two speakers and assigned stable colors
- [x] human lightly-cleaned-verbatim transcript review approved
- [x] pinned offline Wav2Vec2 alignment meets the 98% word gate
- [x] 1920×1080, 1080×1080, and 1080×1920 outputs render
- [x] H.264/AAC/yuv420p/BT.709, duration, FPS, and dimensions verified
- [x] representative title, speaker change, dense copy, and final frames inspected
- [x] no obvious transcript clipping, unsafe-area violation, drift, or color ambiguity

Proof evidence captured 2026-08-07:

- Approved immutable transcript `transcript_de96fa8214d551db3fc1ad8b` contains 24
  cues with confirmed anonymous speaker assignments.
- Two consecutive alignment invocations reused
  `alignment_858de5d6bc2281c50455684a`; all 222 words aligned, with zero
  unaligned, interpolated, invalid, or projection-issue words.
- Ten vocalized pauses remain in the approved transcript and forced-alignment
  evidence. All ten are absent from the three versioned visual scenes, which
  contain 212 visible words under `non-visual-fillers-hold-v1`.
- The first aligned `um` spans 32.494–32.595 seconds. In the title-offset scene,
  the preceding visible word `that` holds from 33.912 to the next visible word
  `this` at 34.736 seconds. The terminal filler-only cue is omitted and the
  final visible `know.` holds through the 89.000-second scene end.
- All three renders are exactly 2,136 frames / 89.000 seconds at 24 fps. They
  contain H.264 video, AAC 48 kHz stereo audio, yuv420p pixels, and BT.709
  color metadata. Automated manifest quality passed for every aspect; the
  audio measured -27.0 dB mean / -3.1 dB peak in the 16:9 output.
- Twenty-one generated QC frames cover the title, both speaker colors, longest
  cue, fastest word, cue transition, and final hold across all aspect ratios.
  Visual inspection found no obvious clipping, unsafe-area violation, drift,
  or ambiguous speaker color.

## Deferred release gate

A full 62-minute 16:9 soak render remains required before promoting 0.1.0 from
release candidate to final. It is not required to cut `0.1.0-rc.1`.
