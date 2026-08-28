# Common user-flow regression matrix

This matrix connects product behavior to automated coverage and the remaining
signed-app checks. Automated tests use synthetic fixtures; real podcast media
and private review data must not enter the repository or CI.

| Flow | Protected behavior | Automated coverage | Remaining release check |
|---|---|---|---|
| Create a project | Probe, copy source, initialize, prepare, analyze, stop for review, approve, align, then wait for an explicit render action | `AppStateTests.workflow`, CLI command/contract tests, project and prepare tests | Run the native flow with approved local test media |
| Name speakers | Default labels remain anonymous; edited display names become recognized; mixed and legacy revisions stay accurate | `transcript-summary.test.js`, `CLIContractTests`, `AppStateTests.transcriptSummaryPresentation` | Confirm the Transcript card and review tab agree |
| Reopen and resume | Status restores only validated active evidence and never rerenders a completed project automatically | project-status tests, `AppStateTests.opensExistingProject`, automatic-workflow policy tests | Relaunch an approved, aligned, and verified project |
| Revise after render | A new active transcript invalidates old alignment/render selection for the workflow while preserving immutable files | inactive-transcript project-status test, `AppStateTests.postVerificationRevision` | Reopen the revised project and render explicitly |
| Rerender and export | Verified projects rerender only on user action; exports refuse collisions | `AppStateTests.verifiedProjectRerender`, render-selection and export-coordinator tests | Render one opaque and one alpha output, then reveal/export |
| Save review and chapters | Dirty working copies save atomically through bounded private inputs | review-workspace, chapter, CLI execution, and private-staging contract tests | Quit/relaunch with a saved working copy and continue |
| Cancel or fail | Last valid stage and existing data remain; the message provides a safe recovery step | cancellation tests, subprocess process-group test, AppStore failure-presentation tests | Cancel analysis, alignment, and render from the native app |
| Manage models | Only exact verified local models are imported or downloaded; symlinked roots are rejected | model-management and `ModelLibraryTests` | Import and download each pinned model in the signed sandbox |
| Edit branding | Text and local PNG are validated and copied into the project; prior assets remain | branding contract/store tests and shared private-staging contract | Save, relaunch, render, and confirm the logo/name toggle |
| Generate chapters | On-device suggestions remain bounded and untrusted; deterministic anchors own timestamps | chapter JavaScript and Swift adviser/store suites | Exercise available/unavailable model paths and all exports |
| Update the app | Signed check is silent when current; install remains user approved | release-contract and feed tests | Perform a signed 1.2.3 to 1.2.4 install/relaunch/version hop |

The signed-app checks remain separate from source-level success. A green test
suite does not prove notarization, packaging, update acceptance, real media
quality, or a completed user interaction.
