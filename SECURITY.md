# Security and privacy

## Threat model

Podcast Visualizer processes untrusted media and editable transcript data locally. Primary risks are malicious media triggering decoder flaws, path traversal or symlink escape, local review-server request forgery, command injection, accidental disclosure of private transcripts, dependency tampering, and resource exhaustion.

Controls in the current release:

- bundled and checksummed media binaries with network protocols disabled;
- no shell-mediated subprocess execution;
- bounded regular-file inputs and allowlisted project descendants;
- immutable manifests with canonical SHA-256 binding;
- loopback-only review service with session authorization and origin checks;
- no remote review assets, telemetry, or automatic media upload;
- bounded app-owned diagnostic events with no paths, command arguments, media,
  transcript, model, review, render, review-token, or raw helper-stream data;
- explicit model import with publisher/revision/file/hash allowlists;
- locked dependencies, secret scanning, SBOM, notices, and offline smoke tests;
- bounded cue/word/turn counts and streaming render intermediates.

Release builds add an inside-out Developer ID signature for every nested Mach-O
binary, Apple's hardened runtime, Apple notarization and stapling, Gatekeeper
assessment, a signed Sparkle appcast and update archive, checksums, an SBOM,
build metadata, and provenance attestation. Sparkle performs one background
feed check at launch without system profiling; downloading and installation
remain user approved. Sparkle's sandboxed services own update networking, and
no media, transcript, model, review, project, or render data enters the request.

Do not report sensitive media or transcript content in an issue. Use the
manually exported, reviewable diagnostic report for ordinary support metadata;
it is never uploaded automatically and never replaces an existing export. See
[`docs/support-diagnostics.md`](docs/support-diagnostics.md). Security reports
should initially contain only reproduction metadata and can be coordinated
privately with the repository owner.
