# Release runbook

Podcast Visualizer stable releases are built from immutable signed semantic
version tags by `.github/workflows/release.yml` on a GitHub-hosted macOS runner.
Release credentials exist only in the protected `release` environment.
The workflow selects Xcode 26.3 explicitly so GitHub's older default Xcode does
not change Swift concurrency behavior or the release build toolchain.

Node, the Python/WhisperX environment, and bundled diarization weights are
intentionally excluded from Git. The workflow restores that release closure
from the `v0.1.0-rc.3` archive using its hard-pinned SHA-256, validates archive
containment, then revalidates every runtime and model manifest before assembly.

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
   `npm run check`, and `swift test --package-path macos
   --disable-automatic-resolution`.
4. Build the app with `scripts/release/build-app.sh` in a new absolute release
   directory outside a synced working tree.
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

## Publish

Create and verify a signed annotated `vMAJOR.MINOR.PATCH` tag, then push it.
The release workflow re-runs all source gates, creates an ephemeral signing
keychain, signs and notarizes fresh artifacts, generates the Sparkle feed,
attests the principal artifacts, and publishes:

- `Podcast-Visualizer-VERSION-arm64.dmg`
- `Podcast-Visualizer-VERSION-arm64.zip`
- `appcast.xml`
- `SHA256SUMS`
- `Package.resolved`
- `BUILD-METADATA.txt`
- `SBOM.cdx.json`
- `NOTARIZATION-APP.json`
- `NOTARIZATION-DMG.json`

After publication, download the checksum file and assets into an empty
directory and run `shasum -a 256 -c SHA256SUMS`. Confirm that Gatekeeper accepts
the DMG and app on a clean Apple Silicon account, then use the previous stable
app's **Check for Updates…** command to exercise replacement and relaunch.
