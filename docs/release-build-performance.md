# Release build performance

Last measured: 2026-08-26.

## Baseline

The successful hosted `v1.2.2` release run `32934575319` took 14 minutes 28
seconds. Before release signing began, it spent 6 minutes 35 seconds restoring
and optimizing the pinned runtime, rebuilding the speech sidecar, rerunning the
same commit's source and Swift tests, validating the runtime, and assembling the
unsigned app. The exact step durations were:

- pinned runtime restore: 1 minute 39 seconds;
- speech-sidecar build: 2 minutes 1 second;
- source validation: 1 minute 44 seconds;
- complete-runtime validation: 11 seconds;
- release-app build and assembly: 36 seconds.

The remaining time was primarily fresh signing, two Apple notarization passes,
ZIP/DMG compression, Sparkle delta generation, checksums, attestation, and
publication. Those release-specific operations are intentionally retained.

## Exact-commit reuse contract

The required macOS CI job continues to resolve locked dependencies, run both
Swift test suites, and build the arm64 app and speech sidecar with Xcode 26.3.
For successful pushes to `main`, it then restores and verifies the same
checksum-pinned release runtime, stages the reviewed speech sidecar, assembles
an unsigned neutral-version app, validates the complete packaged runtime, and
stores the result as a seven-day internal artifact.

The internal artifact is attested by GitHub and bound to the repository,
workflow, `main` ref, exact commit, hosted runner, workflow run and attempt,
Xcode version, Record submodule revision, build-input digest, app executable,
rebuilt speech binary and manifest, Sparkle framework, and Sparkle release-tool
hashes. Only the reviewed speech binary and its self-hashed manifest may differ
from the source commit during preparation; any other tracked change fails the
handoff. Its extractor rejects
traversal, hard links, escaping or dangling symbolic links, special files,
duplicate paths, unexpected roots, unsafe permission modes, and oversized
archives. The constrained original `0600`, `0644`, `0700`, and `0755` modes are
preserved exactly.

Release accepts that app only when the complete `ci` workflow succeeded for the
exact tagged commit on `main`. It verifies the attestation and metadata, patches
only the already-release-variable bundle version and build number, then reruns
the packaged launcher, bundle-structure, runtime-manifest, model, and
alignment-only checks. Signing, notarization, stapling, packaging, mounted-DMG
readback, Sparkle feed and delta generation, size budgets, checksums, SBOM,
release attestation, and publication still run fresh.

This moves compilation and runtime preparation out of the release's critical
path without changing the application payload or weakening any final-artifact
gate. If a tag is pushed while its exact `main` CI run is still active, release
waits for up to 30 minutes for the successful attested handoff. The first
release using the handoff must record hosted step timings before the improvement
is described as measured rather than projected. If the seven-day artifact
expires, rerun CI for the exact commit; release fails closed instead of
rebuilding an unverified substitute.
