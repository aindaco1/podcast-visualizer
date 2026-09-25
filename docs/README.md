# Podcast Visualizer documentation

Use this index to find current guidance, planned work, and historical evidence.
The [project README](../README.md) covers installation, model setup, and the
product overview. Contributors should first read [AGENTS.md](../AGENTS.md).

## Current guidance

| Document | Authority |
|---|---|
| [Project handoff](codex-project-handoff.md) | Restart instructions, architecture boundaries, and pointers to recorded release/acceptance status |
| [CLI/app contract](cli-app-contract.md) | Native/CLI commands, review schemas, workflow decisions, progress, and model storage |
| [Chapter generation](chapter-generation-v1.md) | Local chapter planning, grounded timestamps, immutable artifacts, and evaluation |
| [Transcript reflow](smart-transcript-reflow.md) | Word-preserving approval reflow and optional on-device boundary advice |
| [Renderer readability](renderer-readability-v1.md) | Layout, timing, punctuation, contrast, and versioned rendering evidence |
| [Editor compatibility](editor-compatibility.md) | Transparent-output profiles and editor qualification |
| [Support diagnostics](support-diagnostics.md) | Local logging, crash summaries, reviewed issue submission, and release gates |
| [Security and privacy](../SECURITY.md) | Threat model, data boundaries, and security reporting |

## Development, testing, and releases

- [Shared native migration](shared-native-migration.md): ownership, version pins,
  Jev comparison, runtime provenance and independent rollback.

| Document | Purpose |
|---|---|
| [Release runbook](release-runbook.md) | Current release procedure and required gates |
| [Release build performance](release-build-performance.md) | Exact-commit CI reuse contract and hosted measurements |
| [User-flow regression matrix](testing/user-flow-regressions.md) | Automated coverage and separate installed-app checks |
| [Jev development evaluation](testing/jev-evaluation.md) | Synthetic chapter/reflow checks, local Apple model/context comparisons, shared judge adapter and privacy boundary |
| [September render and split investigation](testing/2026-09-render-and-split.md) | Report evidence, reproduced fixes, diagnostics, and overlap-quality limits |
| [macOS 27 readiness](testing/macos-27-readiness.md) | Toolchain compatibility gates and physical acceptance matrix |
| [1.3.0 confidence calibration](testing/1.3.0-confidence-calibration.md) | Aggregate-only calibration evidence and limits |
| [1.3.0 performance baseline](testing/1.3.0-performance-baseline.md) | Transcript-review measurements and performance gates |
| [1.3.0 DRY audit](testing/1.3.0-dry-audit.md) | Shared ownership and regression coverage |
| [1.2.4 DRY audit](testing/1.2.4-dry-audit.md) | Earlier consolidation findings and deferred opportunities |

Versioned release notes below own release outcomes and acceptance evidence.
Source tests, CI, signed artifacts, public downloads, and installed-app/updater
acceptance must be recorded separately.

## Planned work

The [roadmap](roadmap.md) owns future scope and acceptance criteria, including
the bottom audio waveform. Add active plans there as linked documents so
completed release plans do not become competing roadmaps.

## Release history

The root [changelog](../CHANGELOG.md) summarizes changes across versions.
These notes retain version-specific scope, validation, and release outcomes;
an entry alone does not establish that a version was published.

| Version | Notes and supporting history |
|---|---|
| 1.3.6 | [Release notes and acceptance](releases/1.3.6.md) |
| 1.3.5 | [Release notes and acceptance](releases/1.3.5.md) |
| 1.3.4 | [Release notes and acceptance](releases/1.3.4.md) |
| 1.3.3 | [Release notes and acceptance](releases/1.3.3.md) |
| 1.3.2 | [Release notes and acceptance](releases/1.3.2.md) |
| 1.3.1 | [Release notes and acceptance](releases/1.3.1.md) |
| 1.3.0 | [Release notes](releases/1.3.0.md), [completed execution plan](releases/1.3.0-plan.md) |
| 1.2.4 | [Release notes](releases/1.2.4.md) |
| 1.2.3 | [Release notes](releases/1.2.3.md) |
| 1.2.2 | [Release notes](releases/1.2.2.md) |
| 1.2.1 | [Release notes](releases/1.2.1.md) |
| 1.2.0 | [Release notes](releases/1.2.0.md) |
| 1.1.2 | [Release notes](releases/1.1.2.md) |
| 1.1.1 | [Release notes](releases/1.1.1.md) |
| 1.1.0 | [Release notes](releases/1.1.0.md) |
| 1.0.9 | [Release notes](releases/1.0.9.md) |
| 1.0.8 | [Release notes](releases/1.0.8.md) |
| 1.0.7 | [Release notes](releases/1.0.7.md) |
| 1.0.6 | [Release notes](releases/1.0.6.md) |
| 1.0.5 | [Release notes](releases/1.0.5.md) |
| 1.0.4 | [Release notes](releases/1.0.4.md) |
| 1.0.3 | [Release notes](releases/1.0.3.md) |
| 1.0.2 | [Release notes](releases/1.0.2.md) |
| 1.0.1 | [Release notes](releases/1.0.1.md), [completed plan](releases/1.0.1-plan.md), [performance](releases/1.0.1-performance.md), [size audit](releases/1.0.1-size-audit.md) |
| 1.0.0 | [Release notes](releases/1.0.0.md) |
| 0.1.0-rc.3 | [Historical CLI candidate checklist](releases/0.1.0-rc.3-checklist.md) |

## Archived foundation plans

- [Original CLI implementation plan](archive/implementation-plan.md)
- [macOS app release-candidate plan](archive/macos-app-rc-plan.md)

These completed plans preserve design rationale and earlier acceptance
criteria. Their proposed behavior may have been superseded; use the current
guidance above for implementation and operations.

## Documentation maintenance

- Keep the project README focused on installation and product orientation.
  Keep the handoff focused on restarting development; link to detailed
  contracts, release procedures, and history instead of copying them.
- Update the document that owns a behavior or procedure when it changes.
  Preserve dated evidence in versioned release/testing documents. Archive
  completed foundation plans and retain release-specific plans beside their
  release notes.
- Link new documentation from this index or an indexed guide. Update local
  links and documentation tests whenever a file moves.
- Keep README, [LICENSE](../LICENSE), [AGENTS.md](../AGENTS.md),
  [CHANGELOG.md](../CHANGELOG.md), [SECURITY.md](../SECURITY.md), and
  [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) at the repository root.
  Contributor scope, the update feed, and packaging rely on those entry points.
  Component and dependency license texts remain in their existing locations.

Run the documentation checks with `node --test test/docs.test.js` from the
repository root. They validate local links, navigation coverage, and stable
release metadata.
