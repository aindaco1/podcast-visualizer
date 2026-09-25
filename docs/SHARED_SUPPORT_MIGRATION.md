# Shared support migration

Podcast Visualizer 1.3.6 advances Platform to `b32a38b34f83daf142bd42d0c8f80ff4220952ad`, Desktop Swift 0.3.0 and Apple Support 0.1.0. Existing diagnostics imports continue through the compatibility facade. The app retains its exact Sparkle pin, report schema, preview, consent, endpoint, storage and error policy.

The transport and receipt implementations moved unchanged to a Foundation-only sibling package so Road Notice can share them. This app does not acquire iOS collection or background uploads. The app's source and license packaging include the sibling package. Product media, formatting and updater policy are unchanged.

Validation uses the app's existing tests and release gates, plus shared transport/receipt characterization. Hosted CI, signed artifacts and installed update acceptance are recorded separately in this migration's pull request and release evidence.

Published September 25, 2026: [1.3.6 (29)](https://github.com/aindaco1/podcast-visualizer/releases/tag/v1.3.6)
passed exact-main CI and its signed release workflow. All eleven hosted assets
matched provider digests and checksums; attested archives/feed/delta/SBOM/size
metadata matched the release source. The downloaded DMG passed layout, signature,
notarization and runtime checks. An unchanged isolated copy of public 1.3.5 (28)
updated through Sparkle to 1.3.6 (29), matching the verified release executable.
The installed user app and media were preserved. This maintenance acceptance
does not claim new media-quality or physical-hardware results.

Rollback: revert this migration commit to restore Platform `fa7a8b3310819ce7d2c29f18b481966805bf2d1c` and Desktop Swift 0.2.0. No user-data or report schema migration is required.
