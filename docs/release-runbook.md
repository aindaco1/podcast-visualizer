# Release runbook

Podcast Visualizer stable releases are built from immutable signed semantic
version tags by `.github/workflows/release.yml` on a GitHub-hosted macOS runner.
Release credentials exist only in the protected `release` environment.
The workflow selects Xcode 26.3 explicitly so GitHub's older default Xcode does
not change Swift concurrency behavior or the release build toolchain.

The latest completed example is `v1.3.4` at commit
`d8b721a5d0b4000262fcb75dd4b31adc213e5512`: exact-commit CI run
`35932744777` and release run `35933710187` both succeeded on 2026-09-23.
The [release record](releases/1.3.4.md) includes public artifact checks and the
completed installed 1.3.3 to 1.3.4 updater and synthetic transcript acceptance.

Node, the Python/WhisperX environment, and bundled diarization weights are
intentionally excluded from Git. Required `main` CI restores the offline
Python/model closure from the `v0.1.0-rc.3` archive using its hard-pinned SHA-256
and validates archive containment. Online Node is downloaded independently
from `resources/runtime-manifests/node-macos-arm64.json`, checksum-verified,
optimized into a new destination, and tested against the public eMudhra TLS
chains before installation. The archived Node must not be restored into a
release. CI then builds the reviewed speech sidecar and unsigned app, and
attests the exact-commit result for release reuse. The release job accepts only
the successful CI artifact for its exact tagged commit and revalidates every
runtime and model manifest before signing. See
[release-build-performance.md](release-build-performance.md) for the measured
baseline and provenance contract.

The macOS lane installs the locked JavaScript dependencies before preparing the
runtime. Runtime optimization uses the shared Node process adapter, so Swift-only
validation does not supply its package dependency. Pull requests also load the
release-preparation modules after installation; the full artifact preparation
and attestation remain restricted to main.

Both app builders stage the pinned production Platform packages through
`scripts/macos/stage-cli-packages.mjs`. This copies timed-text and Node Core
inside the app without checkout-relative npm links. The core PR gate runs the
real staged CLI outside the checkout and confirms that omitting Node Core fails;
bundle verification also requires its package metadata and process entrypoint.

The release runner also installs the tagged checkout's locked JavaScript
dependencies before validating the restored app. These are required by the
repository-side alignment and packaging validators even though the app already
contains its own dependencies. A fresh-workspace regression runs the actual
alignment validator before and after an offline locked installation.

For a workflow-only failure before publication, merge the workflow correction
through its normal checks, then dispatch Release from the corrected `main`
with the existing signed tag as its `tag` input. Checkout, source validation and
attested app restoration still use that immutable tag and its exact successful
main CI run; do not move the tag or substitute a different app artifact.

## Required environment secrets

- `CERTIFICATE_P12_BASE64`
- `DEVELOPER_ID_CERTIFICATE_PASSWORD`
- `DEVELOPER_ID_APPLICATION`
- `RELEASE_KEYCHAIN_PASSWORD`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `SPARKLE_ED25519_PRIVATE_KEY`

Never store these values in the repository, workflow logs, release assets, or
build metadata. The Sparkle private key is unique to Podcast Visualizer; it is
not shared with another app.

## Pre-tag gates

1. Set the same semantic version in `package.json`, the app `Info.plist`, the
   release notes, and the changelog.
2. Resolve and commit `macos/Package.resolved`.
3. Run `npm ci --ignore-scripts`, `npm audit --omit=dev --audit-level=high`,
   `npm run check`, `npm run test:coverage`,
   `PODCAST_VISUALIZER_MACOS_VALIDATION=test ./scripts/ci/validate-macos.sh`,
   and `git diff --check`.
4. Build the app with `scripts/release/build-app.sh` in a new absolute release
   directory outside a synced working tree.
   Before signing its inherited-sandbox helper, run
   `runtime/macos-arm64/bin/node scripts/check-tls-trust.mjs`; require a valid
   HTTPS control and certificate rejection for all twelve test chains through
   both `https` and `fetch`. A timeout or DNS failure is not acceptance.
5. Inventory and sign all nested Mach-O code inside-out with
   `scripts/release/sign-app.sh`. Do not use `codesign --deep` as a signing
   method.
6. Notarize and staple the app, package it, then separately sign, notarize,
   staple, and assess the DMG.
7. Run `scripts/release/verify-dmg.mjs` with the packaged Node runtime. It mounts
   the final image read-only, requires exactly the app plus the `/Applications`
   shortcut, and rechecks bundle structure, signatures, stapling, and Gatekeeper.
8. Generate the signed appcast and verify checksums, metadata, SBOM, signatures,
   notarization tickets, and Gatekeeper acceptance.
9. Commit and push the verified source before creating the signed tag. Tags are
   immutable and must not be moved after publishing.

Never silently overwrite a generated stage or release artifact. Validate the
exact assembled app, including its complete Mach-O inventory, reviewed
entitlements, Developer ID chain, notarization ticket, Gatekeeper acceptance,
DMG contents, signed appcast, checksums, SBOM, and build metadata.

## Publish

Create and verify a signed annotated `vMAJOR.MINOR.PATCH` tag, then push it.
The release workflow requires and verifies the exact successful `main` CI run,
creates an ephemeral signing keychain, signs and notarizes the attested unsigned
app, generates the Sparkle feed, attests the principal artifacts, and publishes:

- `Podcast-Visualizer-VERSION-arm64.dmg`
- `Podcast-Visualizer-VERSION-arm64.zip`
- `Podcast.VisualizerBUILD-PREVIOUS_BUILD.delta`
- `appcast.xml`
- `SHA256SUMS`
- `ARTIFACT-SIZES.json`
- `Package.resolved`
- `BUILD-METADATA.txt`
- `SBOM.cdx.json`
- `NOTARIZATION-APP.json`
- `NOTARIZATION-DMG.json`

After publication, download the checksum file and assets into an empty
directory and run `shasum -a 256 -c SHA256SUMS`. Confirm that Gatekeeper accepts
the DMG and app on a clean Apple Silicon account, then launch the previous
stable app and verify the automatic prompt, replacement, and relaunch. Retain
the manual **Check for Updates…** command as a separate fallback check.
Public artifact acceptance and the physical previous-version update hop are
separate claims; record both explicitly and do not infer either from source or
CI success.
