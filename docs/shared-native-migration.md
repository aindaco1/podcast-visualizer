# Shared native migration

The speech sidecar and app's Apple advisers now use
`shared/dust-wave-platform/native`. Product chapter/boundary policy, speaker
identity, immutable evidence and review/export rules remain here. FluidAudio
stays exactly 0.15.5, including progress and exact speaker-count support.

New speech runtime manifests use v3 (unsigned) / v4 (signed) and `platformRevision`.
Earlier v1/v2 manifests retain their original `recordRevision` validation and
attribution. Schema ownership is explicit; hashes, exact fields, file checks and
signing guards remain required. CI app artifacts use v2 and bind the Platform
pin. An old artifact cannot be reused as a migrated build.

Initialize submodules, run `npm test`, Swift tests in `macos` and `speech-sidecar`,
then `npm run test:jev -- --live` with existing developer credentials. The suite
captures production output and hashes shared Apple source alongside app policy.
Keep synthetic fixtures, questions and thresholds frozen for baseline comparison.
Jev cannot override exact failures, missing inference, or controls needing review.

Rollback restores the former gitlinks, manifests/lockfiles, adapters and packaging
scripts together. Existing projects require no migration. The extraction itself
did not publish an app; it is included in the subsequently authorized
[1.3.3 release](releases/1.3.3.md).
