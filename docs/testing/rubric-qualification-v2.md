# Chapter rubric qualification, second round

**Latest checkpoint:** the method-aware candidate reduced incorrect rejection
and review observations from **7/26 to 2/26** on thirteen distinct development
titles, with no false approvals. Its full suite has 19/20 controls resolved
correctly, 27/28 generated candidates passing, and two review entries for the
same already-approved clarity question. All eight exact controls pass.
Fresh independent labels are pending; the candidate remains opt-in and the
default is unchanged. The sections below retain the failed experiments too.

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

## Measured diagnosis, 2026-09-24 UTC

Wrangler authorization completed. Three complete batches used 24 requests and
72 questions each; none had false approvals or unevaluated cases.

| Experiment | Current correct / false rejection / review | Challenger correct / false rejection / review |
| --- | --- | --- |
| Focus only, `run-aGvf8f` | 9 / 1 / 2 | 10 / 0 / 2 |
| Explicit criteria, known, `run-yEuGOw` | 8 / 3 / 1 | 8 / 3 / 1 |
| Explicit criteria, reused, `run-Bm2GxW` | 11 / 0 / 1 | 8 / 0 / 4 |

Each column has twelve observations over six distinct titles. The simpler names
focus passed both repeats of the accepted paraphrase. Room-tone grounding/style
still varied even for identical requests. The explicit criterion is rejected:
it did not reduce work on the known cases and increased reviews on reused cases.
Full distributions and request hashes remain in the immutable run directories.

## Next frozen hypothesis: short labels, separate judgments

The remaining questions conflate source completeness, navigation usefulness and
title form. A short chapter title need not restate every qualification, and the
style check should judge natural wording rather than repeat factual/navigation
requirements. Compare `shortTitleRequirements` against the unchanged current
rubric, retaining all three dimensions and full source context. This is a joint
rubric experiment; changes cannot be attributed to one question alone.

`--review-short-title` and `--review-short-title-reused` use the same corrected
development targets and labels, 24 requests / 72 questions each, two reversed
repeats, capped at $0.15 per batch. These are batches four and five of ten.
The faithful and naive offline checks must match the same exact predictions
(eight and sixteen false approvals respectively) before either live call.
No threshold changes, title allowlists or accepted-label examples enter requests.
Fresh user validation remains unscored and awaits labels. The default rubric
remains unchanged until the acceptance target and independent check are met.

### Short-label result and direct predicate hypothesis

Batch four, `run-iggkfI`, failed the target: current had eight correct/four
false rejections, short-title six correct/six false rejections; neither had
false approvals or reviews. Grounding and form accepted all useful titles,
but “gives a specific reason to visit” also rejected an unambiguous volume
paraphrase. Cancel the redundant reused-set run for this rejected candidate.

Next compare a single affirmative subject predicate: “The title conveys
{focus}, directly or through a common paraphrase.” This tests whether the
abstract visit/reason instruction imposes an unintended extra demand. Keep
the short-title grounding/form questions, full reference, corrected targets,
and all labels. Vague negatives remain essential: this wording is unacceptable
if the simplicity increases false approvals. `--review-direct` and
`--review-direct-reused` are batches five and six (24 requests/72 questions,
$0.15 each). Same offline predictions and reversed repeats. This is the final
development wording candidate in this ten-batch round, not a search for a
fortunate repeat. Retain failure evidence if the target is missed.

### Selected candidate frozen for independent checking

Batches five/six, `run-XW6vmz` and `run-FAGzfp`, met the development target:
current 20/24 correct with four false rejections; direct 24/24 correct with
zero false approvals, false rejections, reviews or repeat flips. These are
twelve distinct titles (six accepted, six rejected), each observed twice.
The previous holdout is consumed development evidence, not fresh validation.

Freeze `directTitleRequirements` exactly as measured. It is shared by the
comparison and the opt-in `--chapter-rubric=direct` full suite, avoiding a
parallel implementation. This option is offline by default and changes only
the three-question chapter rubric; native generation,
transcript rules, exact checks, model and margin remain unchanged. The default
remains current until the fresh labels establish no regression.

Before adoption, use one bounded full synthetic/native run (48 requests,
67 questions, $0.15 maximum estimate) with this frozen candidate. It is batch
seven of ten. No changes to the rubric after seeing the reserved validation
results. The remaining three batches are reserved for the sixteen fresh titles,
partitioned into at most six cases per batch, two variants and two repeats.

Repeat reporting now also compares each question's decision, so an abstention
cannot disappear behind an unchanged overall rejection. Historical reports
remain untouched; tests cover this previously hidden transition.

### Full-suite scope correction

Batch seven, `run-ZzAVPy`, passed all eight exact controls and had no missing
native output or exact failures. The new three-question rubric accepted the
human-approved question and backup paraphrases. However, applying its subject
wording alone to the short-source navigation controls falsely approved
“Caption formatting consistency” (pass .45, uncertain .28, fail .27). This is
a different request contract from the development comparison. That broader
application is rejected, and its evidence is retained.

Keep the established standalone navigation rule byte-for-byte for every such
control; apply the candidate only to the full three-question chapter contract.
Regression tests enforce that scope. Do not add title exceptions or soften the
negative label. Batch eight repeats the full synthetic/native suite with this
corrected scope, 48 requests/67 questions, $0.15 estimate limit. This is a new
scope check, not a retry of a failed provider call. The three-question candidate
wording stays frozen. The generated technique-only caption title still needs
the user's content judgment; it must not be relabeled to produce a green run.

The sixteen reserved validation titles still require three separate batches.
If all are run, allow one additional $0.15 batch beyond the original ten,
solely to finish the already-declared independent validation (no new candidate
or tuning). The maximum for this entire round is therefore eleven batches.

## Current measured result

Batch eight, `run-BmETPE`, matched **20/20 semantic controls** and **8/8 exact
controls**, with no false approvals, false rejections, abstentions, missing
outputs or deterministic failures. Generated candidates were 27 pass / 1 fail.
The sole flag is the caption topic “How to split captions at natural phrase
boundaries”: the subject decision was fail, while grounding/form passed.
That is an unresolved product judgment, not an established judge error.
All transcript reflow and punctuation outputs passed their exact/semantic checks.

Across eight complete second-round batches: 240 requests, 566 questions,
173,806 reported input tokens, 109,764 ms summed request elapsed time, and
$0.007299852 estimated inference at the documented rate (not a bill). All
responses used `jev-1.13.0`. Failed candidate results are included in these
totals. No inference retry or threshold change occurred.

The final development pair has six distinct accepted and six distinct rejected
titles, each repeated twice. Current accepted eight/twelve positive observations;
the candidate accepted twelve/twelve. Both rejected twelve/twelve negative
observations. The candidate therefore meets the predeclared development target,
but these small development results do not prove general calibration.

Independent validation remains pending the user's labels for sixteen reserved
titles. No requests for those titles have been made and no labels are assumed.
Do not promote the candidate to default or call qualification complete until
that comparison finishes. The existing draft app prompt also remains subject
to the user's judgment of the generated technique-only caption title.

`npm run check` passed 236 JavaScript tests with two existing optional skips;
both fresh native captures passed. Before the latest edits, all three CI jobs
at `e5fb5d9` passed, including Xcode 27 preview. The preceding preview contrast
failure is retained as intermittent evidence, not dismissed as proven fixed.
No Swift app code, dependencies, versions or release artifacts changed in this
round. The candidate and its history reuse the shared transport and the same
product corpus rather than introducing another evaluator.

## User clarification and next bounded round

The user accepted “How to split captions at natural phrase boundaries” on
2026-09-24: the concrete technique is useful navigation. This establishes the
remaining full-suite flag as a false rejection. Add that exact generated title
as a development regression with its unchanged source; do not alter any earlier
labels or overwrite the previous candidate. The direct candidate is insufficient
for this clarified product policy and is not promoted.

Before further inference, freeze `methodTitleRequirements`: retain direct
grounding/form and expand only the subject predicate to allow naming a specific
method for the source's purpose. Keep the existing standalone navigation rule.
This is a policy clarification, not permission for generic activity labels.

Bound this next round to seven batches at $0.15 estimated maximum each: known
development (24 requests/72 questions), consumed development (24/72), the new
technique regression (4/12), the full synthetic/native suite (48/67), and three
fresh independent validation partitions (at most 24/72 each). Keep two reversed
repeats for comparisons. Before live, faithful/naive simulations must match the
eight/sixteen false-approval predictions for known/reused cases and zero for the
single positive regression. A deliberately incorrect prediction must fail.
Do not tune this candidate after inspecting fresh independent labels/results.

### Method-aware results

| Run | Current correct / false rejection / review | Method correct / false rejection / review |
| --- | --- | --- |
| Known, `run-P4w4Ju` | 8 / 4 / 0 | 10 / 0 / 2 |
| Reused, `run-OTYStW` | 11 / 0 / 1 | 12 / 0 / 0 |
| User technique, `run-05ED9H` | 0 / 0 / 2 | 2 / 0 / 0 |

Both variants had zero false approvals or unevaluated cases. Of fourteen
observations of accepted titles, current passed seven and method passed twelve;
both rejected all twelve observations of rejected titles. There are thirteen
distinct titles, not twenty-six independent examples. The 71% reduction in
incorrect rejections/reviews exceeds the predeclared practical development
target, but fresh validation is still required. Candidate repeats had no
choice or decision flips, including individual-question decisions.

Full run `run-llRZDN` retained all eight exact controls, no deterministic failures
and no missing captures. Its semantic controls were 19 correct / 1 review,
with no false approvals or false rejections. Candidates were 27 pass / 1 review,
zero fail. Both review entries are the identical source/title request for
“How do we structure captions for clarity?”, once as a human-labeled control
and once as fresh Apple output. The now-user-approved technique title passed.
The suite exits 1 honestly: review is not a pass, and the 0.10 margin is unchanged.

Use `--review-method`, `--review-method-reused`, `--review-technique` for the
frozen comparisons and `--chapter-rubric=method` for the full suite. The
short-title and direct experiments remain replayable. Standalone navigation,
transcript semantics and exact structural checks remain unchanged.

### Evidence and verification checkpoint

The completed work in this document comprises twelve live batches, 340 requests,
789 questions, 243,889 reported input tokens and 154,984 ms summed request elapsed
time. Estimated inference is $0.010243338 under the documented rate, not a bill.
This includes every unsuccessful candidate and the overly broad full-suite trial.
The three independent validation batches remain unused.

`npm run check` passes 237 tests with two existing optional skips, plus syntax
and secret checks. Three fresh synthetic Apple capture runs passed. Historical
comparison requests were reconstructed and checked against retained request
content after refactoring; the earlier experiments were not silently rewritten.

An independently retained local archive is at
`~/Documents/PodcastVisualizerDevelopmentEvidence/2026-09-24-rubric-qualification/`.
It contains `synthetic-evidence.tar.gz` and `manifest.json`, with 770 synthetic
JSON/Markdown evidence files. Every archived file was hash-verified against its
original, and archive SHA-256 is
`b2191cfc3e8d8d0e25025f3a3585fd687815580a8bb299f93e5965732c3341f6`.
Original immutable run directories remain available. Credentials and private
launcher files are excluded.
