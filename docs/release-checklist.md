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

- Main CI run `31178091215` passed at `966289dabaf644770666d56143227142acb1a766`, including recursive checkout, clean `npm ci`, audit, 53 Node tests with coverage, and 27 locked alignment-runner tests.
- Record PR 42 passed workflow/shell lint, Swift arm64 tests, Swift sanitizer tests, and dependency review at pinned revision `33f8996b4c059637aefbeb49ea2411cdfad816d2`.
- The source-tree doctor passed with `PATH=/usr/bin:/bin` after importing both external models.
- The archive builder extracted and inspected 31,499 files plus eight contained relative symlinks, then ran the archived launcher and doctor without developer runtimes.
- The pre-release archive at commit `966289d` was 389,990,537 bytes with SHA-256 `31951f84153c7e4943f9cec62c07ad78f5ca897e651a20c95c856845aa0f8224`; the published archive will be rebuilt from the final tagged commit.

## Proof gates

- [x] Approved source excerpt acquired outside the product and excluded from Git
- [x] 87-second audio prepared and hashed
- [x] Parakeet produced a timestamped English draft
- [x] anonymous diarization detected two speakers and assigned stable colors
- [ ] human lightly-cleaned-verbatim transcript review approved
- [ ] pinned offline Wav2Vec2 alignment meets the 98% word gate
- [ ] 1920×1080, 1080×1080, and 1080×1920 outputs render
- [ ] H.264/AAC/yuv420p/BT.709, duration, FPS, and dimensions verified
- [ ] representative title, speaker change, dense copy, and final frames inspected
- [ ] no obvious transcript clipping, unsafe-area violation, drift, or color ambiguity

## Deferred release gate

A full 62-minute 16:9 soak render remains required before promoting 0.1.0 from
release candidate to final. It is not required to cut `0.1.0-rc.1`.
