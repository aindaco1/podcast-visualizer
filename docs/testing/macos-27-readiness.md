# macOS 27 and Xcode 27 readiness

Last reviewed: 2026-09-02.

Podcast Visualizer continues to support macOS 15 and later. The signed release
workflow remains pinned to stable Xcode 26.3 while macOS 27 and Xcode 27 are in
beta. Do not raise the deployment target or move release signing to a beta
toolchain solely to gain compatibility coverage.

## Automated compatibility gates

Every pull request and push to `main` now runs two macOS lanes:

- `Swift tests and arm64 builds` is the required baseline on `macos-15` with
  Xcode 26.3. It tests and release-builds both the app and speech sidecar.
- `Xcode 27 compatibility (preview)` is advisory while GitHub's `xcode-27`
  runner is in public preview. That runner currently provides Xcode 27 and the
  macOS 27 SDK on macOS 26, so it catches compiler and SDK problems but does not
  prove runtime compatibility on macOS 27.

Both lanes use `scripts/ci/validate-macos.sh`, reject unexpected build engines
or modes, preserve both `Package.resolved` files, disable automatic dependency
resolution for builds and tests, and require arm64 release binaries.

The exact v1.3.0 commit passed hosted run `33611991255` on macOS 26.5.2 with
Xcode 27.0 build `27A5228h` and Swift 6.4. The runner and Apple toolchain remain
pre-release; this is compile/test evidence, not macOS 27 runtime acceptance.

The app test target depends on the app executable, which embeds Sparkle. Swift
Package Manager issue [#10384](https://github.com/swiftlang/swift-package-manager/issues/10384)
currently prevents Swift Build from staging binary frameworks for this kind of
test. The preview lane therefore release-compiles both products with Swift
Build, then runs the full tests and builds with native SwiftPM. Remove this
split only after the upstream issue is fixed and the complete gate passes with
Swift Build.

## Beta and release-candidate runtime matrix

Use synthetic or explicitly approved test media. Never upload user audio,
transcripts, model inputs, review data, models, credentials, or private logs as
test evidence.

### Installation, storage, and security

- [ ] Upgrade an older signed release in place and open an existing project.
- [ ] Confirm project media and branding copied into the project remain usable
  after the original imports are removed.
- [ ] Confirm security-scoped access survives relaunch for approved project and
  model locations, while unapproved locations remain inaccessible.
- [ ] Confirm the app-owned model store, downloaded models, and user-approved
  model folders remain available after app and OS updates.
- [ ] Download each pinned model through the sandboxed network client and
  verify its canonical hash before activation.
- [ ] Confirm the packaged Node, Python/alignment, FFmpeg, and Swift sidecar
  launch from the signed bundle without relying on ambient `PATH`.
- [ ] Verify the app, nested code, DMG, and update archive remain Developer ID
  signed, notarized, stapled where applicable, and accepted by Gatekeeper.

### Transcription, advice, and alignment

- [ ] Transcribe with Parakeet while the app is active; verify deterministic
  progress, cancellation, transcript review, save, and approval.
- [ ] Repeat Parakeet and alignment with the window inactive and during display
  sleep. Record timing and failures without weakening sandbox entitlements.
- [ ] If macOS 27 suspends inactive local inference, reproduce on a minimal
  signed build before evaluating any new background-inference entitlement.
- [ ] Exercise Foundation Models transcript advice when available and confirm
  the local deterministic fallback when the model is unavailable or disabled.
- [ ] Run alignment, cancel it, relaunch, and resume without overwriting an
  immutable approved transcript or prior generated stage.

### Rendering and updating

- [ ] Render representative short synthetic projects as landscape H.264,
  compact HEVC alpha, and ProRes 4444 alpha.
- [ ] Verify progress, cancellation, relaunch behavior, audio sync, alpha,
  dimensions, frame rate, color metadata, and that prior outputs are preserved.
- [ ] Confirm long renders stream directly and create no image-sequence
  intermediates; compare performance with the macOS 26 baseline.
- [ ] Launch an older signed release, verify Sparkle prompts automatically for
  the new signed update, then repeat through the manual update control. Confirm
  projects and external models remain intact after replacement and relaunch.

## Promotion criteria

1. Remove `continue-on-error` from the Xcode 27 lane when the hosted runner is
   generally available and the lane is consistently green.
2. Run the matrix above on at least one Apple Silicon Mac for each macOS 27
   beta selected for support and again on the release candidate.
3. Move signing, notarization, packaging, Sparkle feed generation, and update
   validation to stable Xcode 27 only after the entire signed-app matrix passes.
4. Keep the macOS 15 deployment target unless dropping it is a deliberate,
   documented product decision.

No speculative entitlement changes are authorized by this plan. Any exception
must be tied to a reproduced failure, minimized, and revalidated in a signed and
notarized build.

## Tracking references

- [Apple macOS 27 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes)
- [Apple Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)
- [GitHub hosted runner rollout](https://github.com/actions/runner-images/issues/14404)
- [SwiftPM binary-framework test staging issue](https://github.com/swiftlang/swift-package-manager/issues/10384)
- [Record macOS 27 readiness issue](https://github.com/aindaco1/record/issues/45)
