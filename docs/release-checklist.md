# 0.1 release-candidate checklist

## Automated gates

- [ ] `npm ci --ignore-scripts` from a clean clone
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] `npm run check`
- [ ] `npm run test:coverage`
- [ ] RecordSpeech PR checks green at the pinned revision
- [ ] alignment-runner `ruff` and `pytest` green with the locked environment
- [ ] `dustwave-video doctor` passes after external model import
- [ ] release archive expands without absolute or escaping symbolic links
- [ ] packaged launcher works without Homebrew, Node, Python, FFmpeg, or `uv`
- [ ] SBOM, third-party notices, component manifests, and archive SHA-256 present

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
