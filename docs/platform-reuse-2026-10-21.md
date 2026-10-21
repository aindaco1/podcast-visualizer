# Platform 0.44 migration — October 21, 2026

Target: 1.3.7. Platform commit: `57cc033e248f92835c4c5ee29c823cadbb5050a2`.
Exact changed package versions: Node Core 0.1.0, Admin Shell 0.14.0,
Site Shell 0.4.0 and Test Core 0.4.0 where consumed. The automated consumer
contract records the complete package map; native dependency lockfiles stay pinned.

## Scope

Node subprocess capture/completion with consumer-owned aggregate budget, three distinct streams, callback policy and privacy-safe error details. Bundle Node Core explicitly in the release. Timeout and stream failures terminate the POSIX process group.

Product models, routes, storage, provider credentials, SDK URLs, content and
publication authority stay in this repository. No checkout or subscriber
operation is required to validate this migration.

## Evidence

242 active tests passed, two optional runtime checks skipped, coverage report completed, and the desktop dependency contract passed before the additional descendant regression case. Exact-source macOS CI, signed package and actual update acceptance remain required.

Independent pre-migration source rollback was rehearsed at consumer
`178d32d9f6d4f272f0de2843d1273fb4ded53616`, retaining its original Platform pin `b32a38b34f83daf142bd42d0c8f80ff4220952ad`.
Source rollback means reverting the complete migration (adapters, bundle entries,
package contracts and gitlink together), never changing the gitlink alone.
An app rollback must install the preceding verified signed release; deployed
services retain their own previous artifact and deployment rollback procedure.
A source rehearsal is not a claim that production was rolled back.

CI and publication evidence belongs to this consumer pull request and final
release record. Do not equate a local build or a green source check with a
published app or production deployment.
