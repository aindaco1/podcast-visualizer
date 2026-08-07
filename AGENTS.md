# Podcast Visualizer contributor instructions

- Preserve user media and existing outputs. Generated stages are immutable and must not be silently overwritten.
- Use `apply_patch` for hand-authored repository edits.
- Keep the product local-first. No media, transcripts, model inputs, or review data may leave the machine.
- Bind review services to loopback and require a per-session write token plus origin validation.
- Invoke subprocesses with argument arrays and `shell: false`. Resolve release tools from the packaged runtime, not ambient `PATH`.
- Reject traversal, symlink escapes, unexpected fields, unsafe identifiers, and non-canonical hashes at trust boundaries.
- Add or update automated tests for every bug fix and every contract change.
- Establish performance baselines before optimizing. Long renders must stream and must not create image-sequence intermediates.
- Keep generic timed-text, alignment, scene-planning, and audio-reactive logic in shared packages; keep application policy in this repository.
- Never commit source podcast media, model weights, credentials, or private review artifacts.

