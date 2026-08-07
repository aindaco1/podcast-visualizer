# 0.1.0-rc.3 release-candidate checklist

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

- Release-candidate 3 CI run `31204150635` passed at
  `4c499b2075f2859bd407c810c23118ceaa3d1128`, including clean install,
  zero-vulnerability production audit, 59 Node tests with coverage, real
  compact/ProRes alpha runtime smoke tests, and the locked alignment-runner
  lint/test suite.
- Release-candidate 2 CI run `31202482010` passed at
  `2b06c3a49b392dd0d79a603f2584ed001b8ef834`, including recursive checkout,
  clean `npm ci`, zero-vulnerability production audit, 59 Node tests with
  coverage, and the locked alignment-runner lint/test suite.
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
- [x] ProRes 4444/PCM/MOV alpha, duration, FPS, and dimensions verified
- [x] compact HEVC/AAC/MOV alpha, duration, FPS, and dimensions verified
- [x] decoded alpha planes contain both transparent and visible pixels
- [x] representative title, speaker change, dense copy, and final frames inspected
- [x] every visible cue inspected in all three aspect ratios
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
- Release-candidate 2 uses `dust-branded-v2` / `ass-scene-v3`: Inter Light
  transcript type is 92 px at 1920×1080, 82 px at 1080×1080, and 80 px at
  1080×1920. IBM Plex Mono labels, cyan/magenta signal accents, deterministic
  drifting ASCII punctuation, horizontal signal strings, and the persistent
  `DUST//WAVE [A/V]` bug are pinned by `dust-wave-transcript-v2`.
- The six rc.2 proof renders are exactly 2,136 frames / 89.000 seconds at
  24 fps. The three opaque MP4s passed H.264 High/yuv420p/AAC QC. The three
  transparent MOVs passed ProRes 4444/`ap4h`/`yuva444p12le` and 24-bit PCM QC.
- Decoded alpha-plane samples in every overlay span normalized 0.0625–0.9182,
  proving that the files carry mixed transparency. Each overlay also retains
  synchronized 48 kHz stereo podcast audio.
- Sixty-nine cue-midpoint screenshots cover every visible transcript cue in
  every aspect. Exhaustive contact-sheet inspection found no clipping,
  unsafe-area violation, ambiguous speaker color, or brand collision.
- Local rc.2 gates passed with 59 tests, opaque and ProRes-alpha bundled-runtime
  encode smoke tests, syntax and secret scans, coverage collection, and zero
  production dependency vulnerabilities.
- Release-candidate 3 makes VideoToolbox HEVC with auxiliary alpha and AAC the
  default transparent profile, following the working `pool-marketing-docs`
  pattern. ProRes 4444/PCM remains available through `--alpha-codec prores`.
- The three 89-second compact overlays total 60,948,196 bytes versus
  2,359,979,750 bytes for their ProRes equivalents: 97.42% smaller (38.7×).
  Individual sizes are 21,510,711 bytes (16:9), 19,527,905 bytes (1:1), and
  19,909,580 bytes (9:16).
- Generic FFprobe correctly reports HEVC Main/yuv420p but cannot expose the
  auxiliary alpha layer. Every compact proof instead passed AVFoundation
  sample decoding to ProRes 4444 followed by mixed-alpha measurement; title
  samples span normalized 0.0625–0.9214.
- Twenty-one AVFoundation-decoded lossless RGBA QC frames cover title, speaker
  colors, longest cue, fastest word, transition, and final hold across the
  compact overlays. Visual inspection found no compression damage or layout
  regression.
- Local rc.3 gates passed with 59 tests, syntax and secret scans, coverage,
  zero production dependency vulnerabilities, and real bundled-runtime smoke
  tests for opaque H.264, compact HEVC alpha, and ProRes 4444 alpha.

## Deferred release gate

A full 62-minute 16:9 soak render remains required before promoting 0.1.0 from
release candidate to final. It is not required to cut `0.1.0-rc.3`.
