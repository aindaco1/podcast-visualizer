# Chapter rubric qualification, second round

Development evaluation only. Reuse the existing runner, shared Jev adapter,
response validation, immutable evidence and synthetic-only boundary. Keep
model allowlist `jev-1.13.0` and review margin 0.10. No app generation changes
or release are part of this round.

## Acceptance target fixed before new inference

Practical improvement means at least halving incorrect rejections plus review
requests on the development cases, no increased false approvals, and no
regression on fresh user-labeled validation. Report rejected/accepted cases
separately and count distinct examples separately from repeat observations.
This target is not a claim of statistical significance or general calibration.
Incomplete runs never satisfy the target. Keep all failed experiments.

The consumed first-round holdout is now development material. Preserve its
original bytes and historical results. Sixteen new titles over four synthetic
passages have been submitted to the user for independent labels; reserve them
from development scoring and do not assume acceptance while labels are pending.

## Ordered experiments

1. `--review-focus`: compare the original six consumed holdout cases with the
   same cases after changing only the names focus to “Pronouncing names
   correctly.” Keep source, candidates, expected labels and all rubric wording
   fixed. Two repeats per variant in reversed order: 24 requests, 72 questions.
   The unchanged room-tone cases provide a check on repeat variation.
2. Based on that diagnosis, freeze a simpler criterion candidate before its
   development comparison. Separate factual grounding, listener navigation and
   readable title form; avoid requiring every supporting detail in a title.
3. Freeze the selected candidate before evaluating the new user-labeled cases.
   Do not tune against those results. A failed qualification requires a new
   independent validation set for any further candidate.
4. Verify the complete synthetic/native suite after adopting a proven candidate.

Each live batch is capped at 80 questions and a $0.15 conservative estimate.
The first evaluation round is bounded to ten batches; a further round requires
an explicit recorded hypothesis and budget before inference. No automatic
retries, caches, threshold changes or provider fallback. Simulated faithful
and topical-vocabulary judges must first pass the existing scoring-path tests,
including exact false-pass IDs and a deliberately incorrect prediction.

The focus simulation predicts sixteen false approvals from the topical-word
shortcut (four traps, two variants, two repeats) and none from the faithful
fixed test double. These are simulated harness checks, not provider findings.

## Predeclared criterion candidate

Prepare `--review-criteria` (six known development titles) and
`--review-criteria-reused` (the six consumed holdout titles). Each command has
two variants, two repeats, 24 requests and 72 questions. Both variants use the
corrected single-purpose names target. Only the subject question differs:

> Judge this as a short chapter label. Pass when the title's own words express
> this purpose or an ordinary paraphrase: {purpose}. Fail when it names only
> the general activity without that purpose. The source's particular method
> and examples may be omitted.

This hypothesis makes the decision boundary explicit. Grounding and style stay
unchanged so any improvement can be inspected per question. The second-stage
commands remain unrun until the focus comparison has been inspected. Further
changes to grounding or style require a separate recorded comparison. Offline
simulators predict eight false approvals on the known controls and sixteen on
the consumed holdout, with exact IDs checked; faithful simulations have none.

Metrics now split accepted and rejected labels into separate groups, preventing
the larger negative class from hiding rejection of useful titles. No labels,
thresholds or source data are changed by this reporting improvement.

## Preparation checkpoint

The focus and criterion comparisons passed 32 focused offline tests. The full
`npm run check` passed syntax/secret checks and 233 JavaScript tests, with two
existing optional skips. No Swift or app generation code changed in this round.

No second-round Jev requests have been sent yet. The previous Wrangler session
expired; the requested browser login could not be completed because computer
automation found no on-screen Helium window, and Wrangler timed out waiting for
authorization. Fresh validation labels are also awaiting the user's response.
The criterion candidate is unmeasured and is not adopted. This checkpoint does
not claim that the rubric is significantly better.
