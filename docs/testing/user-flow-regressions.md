# Common user-flow regression matrix

This matrix connects product behavior to automated coverage and the remaining
signed-app checks. Automated tests use synthetic fixtures; real podcast media
and private review data must not enter the repository or CI.

| Flow | Protected behavior | Automated coverage | Remaining release check |
|---|---|---|---|
| Review and send failure reports | Opening review never sends; failures retain pending reports; receipts deduplicate retries; native crash summaries exclude private data | `DiagnosticSubmissionTests`, `DiagnosticReportReviewTests`, relay `podcast.test.mjs` in ASCII VJ Remix | Deploy relay, verify synthetic duplicate with authorization, then test explicit Send in signed app |
| Create a project | Probe, copy source, initialize, prepare, analyze, stop for review, approve, align, then wait for an explicit render action | `AppStateTests.workflow`, CLI command/contract tests, project and prepare tests | Run the native flow with approved local test media |
| Name speakers | Default labels remain anonymous; edited display names become recognized; mixed and legacy revisions stay accurate | `transcript-summary.test.js`, `CLIContractTests`, `AppStateTests.transcriptSummaryPresentation` | Confirm the Transcript card and review tab agree |
| Reopen and resume | Status restores only validated active evidence and never rerenders a completed project automatically | project-status tests, `AppStateTests.opensExistingProject`, automatic-workflow policy tests | Relaunch an approved, aligned, and verified project |
| Revise after render | A new active transcript invalidates old alignment/render selection for the workflow while preserving immutable files | inactive-transcript project-status test, `AppStateTests.postVerificationRevision` | Reopen the revised project and render explicitly |
| Rerender and export | Verified projects rerender only on user action; exports refuse collisions | `AppStateTests.verifiedProjectRerender`, render-selection and export-coordinator tests | Render one opaque and one alpha output, then reveal/export |
| Save review and chapters | Dirty working copies save atomically through bounded private inputs | review-workspace, chapter, CLI execution, and private-staging contract tests | Quit/relaunch with a saved working copy and continue |
| Split or merge transcript cues | Text and outside timing are preserved; IDs remain safe; cross-speaker merges require review | shared confidence, ReviewEditing, store, workspace, and browser-server tests | Split at a caret/playhead, Undo/Redo, merge both directions, Save/relaunch, and approve |
| Click transcript text to seek | A single caret click pauses at a labeled estimate; typing, Find, selected text, and stale callbacks do not seek or alter review data | `TranscriptTextNavigationTests`, including native click-observer events, rendered selection, and synthetic local audio | Click between words, refine the playhead, split, Undo, and repeat in the signed app |
| Triage recognition confidence | Tier-only local Parakeet evidence composes with speaker and Unchecked filters in chronology | confidence compiler/calibration, workspace, 10,000-cue store, and contract tests | Inspect calibrated media, check low tiers, Save/relaunch, and clear filters |
| Rename a speaker | Return, focus loss, and switching speakers share one normalized commit; invalid drafts preserve the prior name | ReviewEditing and transcript-review store tests plus view contract | Rename by keyboard and click-away, Undo, Save, and relaunch |
| Cancel or fail | Last valid stage and existing data remain; the message provides a safe recovery step | cancellation tests, subprocess process-group test, AppStore failure-presentation tests | Cancel analysis, alignment, and render from the native app |
| Manage models | Only exact verified local models are imported or downloaded; symlinked roots are rejected | model-management and `ModelLibraryTests` | Import and download each pinned model in the signed sandbox |
| Edit branding | Text and local PNG are validated and copied into the project; prior assets remain | branding contract/store tests and shared private-staging contract | Save, relaunch, render, and confirm the logo/name toggle |
| Generate chapters | On-device suggestions remain bounded and untrusted; deterministic anchors own timestamps | chapter JavaScript and Swift adviser/store suites | Exercise available/unavailable model paths and all exports |
| Update the app | Signed check is silent when current; install remains user approved | release-contract and feed tests | Complete the staged signed 1.2.4 to 1.3.0 replacement, relaunch, and installed-version check |

The September 2026 field-report investigation adds coverage for retained caret
indices after a split (including Unicode normalization and Undo/Redo), long
acoustic gaps in every aspect, duplicate/nested speaker intervals, isolated
ambiguous word spans, render retry after failure/cancellation, and v1/v2
diagnostic export privacy. See [the investigation](2026-09-render-and-split.md)
for evidence and remaining user-machine checks.

`npm run test:render:smoke` runs the macOS encoder/QC integration with synthetic
audio and an eleven-second acoustic gap. It covers opaque H.264, HEVC alpha,
ProRes alpha, decoded transparency, and immutable reuse. It uses local tools
and temporary fixtures, requires the staged macOS FFmpeg/FFprobe runtime and
fonts, and does not transcribe media or qualify a signed app. The ordinary
cross-platform suite skips this explicit hardware-dependent test.

The signed-app checks remain separate from source-level success. A green test
suite does not prove notarization, packaging, update acceptance, real media
quality, or a completed user interaction.

On 2026-09-07, a separate local preview using the current native review views
and synthetic text/audio verified caret-click seeking, Split at Playhead from
that caret, drag selection without seeking, and a text click pausing active
playback. The click observer waits until native text tracking returns to the
default run-loop mode because NSTextView can consume mouse-up internally.
Regression coverage includes that event sequence, repeated clicks at the same
caret, modified clicks, cancellation on teardown, and clicks outside the text
box. This is local preview evidence; the change has not been released.

For v1.3.0, source, CI, notarization, packaging, and public artifact checks are
complete. The previous-version test verified the prompt, archive signature,
and staged app; installed replacement/relaunch acceptance remains open.
