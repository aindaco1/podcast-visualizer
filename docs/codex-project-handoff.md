# Codex project restart handoff

Documentation reviewed against the checkout: 2026-09-06. Release and
installed-app evidence below remains dated 2026-09-02; recheck the relevant
release or installed app before making a new acceptance claim.

## Start here

Open this repository as the Codex project, read the
[contributor instructions](../AGENTS.md), and preserve newer user changes.
Use the [documentation index](README.md) to select the contracts relevant to
the task. Begin with:

```bash
pwd
git status --short --branch
git submodule status --recursive
git log -5 --oneline --decorate
```

The repository has three pinned Git submodules. Initialize them with
`git submodule update --init --recursive` in a fresh clone; do not casually
advance their revisions. For development validation:

```bash
npm ci --ignore-scripts
npm run check
swift test --package-path macos --disable-automatic-resolution
```

## Current product baseline

The recorded stable release is `1.3.0`, published from signed tag `v1.3.0`
on 2026-09-02. The [README](../README.md) owns installation, model setup, and
the current product overview. [Version 1.3.0 release notes](releases/1.3.0.md)
own the source commit, hosted run IDs, published artifact evidence, and
outstanding acceptance status. Earlier changes are indexed in the
[changelog](../CHANGELOG.md) and [documentation index](README.md).

Podcast Visualizer is an Apple Silicon SwiftUI app for macOS 15+ around the
local-first CLI. Version 1.3.0 adds native cue split/merge, tier-only local
recognition-confidence triage, working-copy Checked progress, Edited
disclosure, and automatic speaker-name commits.

The workflow creates a project, prepares and analyzes its copied audio, and
stops for human transcript/speaker review. Approval continues through
alignment; rendering requires an explicit user action. Reopening a completed
project does not rerender it. See the
[CLI/app contract](cli-app-contract.md) and
[user-flow regression matrix](testing/user-flow-regressions.md).

The next planned visual addition is a local, audio-synchronized bottom
waveform. Its scope and acceptance criteria live in the [roadmap](roadmap.md).

## Architecture boundaries

- The CLI owns transcription, alignment, scene/render policy, QC, and immutable
  project manifests. Swift owns typed presentation and process orchestration.
- Generic timed-text, alignment, scene-planning, and audio-reactive logic
  belongs in the existing shared packages; application policy stays here.
- Media, transcripts, review data, and model inputs stay on the Mac. Parakeet
  and English alignment weights remain external and hash-verified; network
  model downloads require explicit user action.
- Current review, chapter, renderer, and diagnostic contracts are linked from
  the [documentation index](README.md). Archived plans preserve design history;
  use current contracts when implementing changes.

## Release operations and open acceptance

Use the [release runbook](release-runbook.md) for pre-tag gates, credentials,
signing, notarization, packaging, and publication. The
[release build performance guide](release-build-performance.md) owns the
exact-commit CI reuse contract and measurements. Follow the
[security policy](../SECURITY.md); keep credentials out of Git, logs, and
artifacts.

The 2026-09-02 evidence records successful source/CI checks, signing,
notarization, publication, and independent public-download verification.
The physical `1.2.4` to `1.3.0` updater gate remains open in that record:
the prompt, archive signature, and staged app were observed, but installed
replacement, relaunch, and post-update version verification were not.
Record any new acceptance evidence in the
[versioned release notes](releases/1.3.0.md). Public artifacts and installed-app
acceptance are separate claims.

## Resume prompt

```text
Continue Podcast Visualizer from docs/codex-project-handoff.md. Work from the
open repository, read AGENTS.md and the relevant current contracts linked from
docs/README.md, preserve all newer changes and immutable project outputs, keep
user data local, add or update tests for every behavioral change, and complete
the requested work through safe verification. Use docs/release-runbook.md for
release work and keep credentials out of Git and logs. Use the existing CLI as
the pipeline authority and the native SwiftUI app as its typed presentation
and orchestration layer.
```
