# Accepted clarity title investigation

The user accepted “How do we structure captions for clarity?”. The latest
full suite routes this title to review twice, as a fixed control and as generated
output. These are the same request, not two independent product defects.

## Existing evidence and frozen diagnostic plan

All stored direct-rubric subject decisions on this exact full-source title pass:
four observations across `run-XW6vmz` and `run-BmETPE`, margins .33, .31, .25
and .15. Six method-rubric observations across `run-P4w4Ju`, `run-llRZDN`
and `run-oHOEm5` choose pass but route to review, with margins approximately
.05, .02, .06, .07, .08 and .10. Grounding and question form pass throughout.
The added method alternative is the only rubric difference between these two
variants. These runs occurred separately, so use a paired comparison to check
the hypothesis rather than assuming causality from historical aggregates.

The last margin is actually `.48 - .38 = .09999999999999998` in JavaScript.
The shared scorer uses `margin < minimumMargin`, making this a numerical
boundary discrepancy at the inclusive .10 minimum. Correct decimal arithmetic
would change that one observation, but the other five would still require review.
It does not explain the whole uncertainty, and lowering the confidence threshold
is not justified. Preserve the scorer and historical decisions in this diagnosis.

Before new inference, freeze `--review-clarity`: existing `direct` versus
`method` wording; six previously labeled titles; two repeats in reversed order;
24 requests / 72 questions; $0.15 maximum estimated spend. Keep the complete
caption source, including its quoted instruction, identical in every request.
Change only the subject predicate. Positives are the accepted clarity question,
the accepted concrete technique and the existing readable-caption purpose title.
Negatives are the existing vague caption title, unrelated microphone question
and quoted instruction. Labels stay outside requests. This is development
diagnosis, not a new independent validation set or a promotion experiment.

Reuse the existing runner, shared transport and hash-allowlisted fixtures.
Faithful simulation must match all 24 decisions; the topical-vocabulary baseline
must produce exactly twelve false approvals on the three named negatives.
An incorrect false-approval prediction must fail. Ordinary tests and the preview
remain offline. Keep model `jev-1.13.0`, margin .10 and default `method`; no
automatic retries, new wording candidates, title exceptions or release.

## Result, 2026-09-24

Run `run-lb7NG3` completed all 24 requests / 72 questions on `jev-1.13.0`.
The preceding expired-token attempt `run-PivOaj` sent zero requests; manual
Wrangler login completed before the measured run. No inference retry occurred.

| Six titles, each observed twice | Direct | Method (current default) |
| --- | --- | --- |
| Correct decisions | 10/12 | 12/12 |
| False approvals | 0 | 0 |
| False rejections | 2 | 0 |
| Overall reviews / unevaluated | 0 / 0 | 0 / 0 |
| Clarity question subject margins | .23, .26 | .15, .12 |

Both direct false rejections are the user-approved technique title, “How to
split captions at natural phrase boundaries”. The method rubric accepts it
and the clarity question in both repeats while rejecting all three negatives.
There are no within-run choice/decision flips. The unrelated microphone
question has two grounding abstentions under method, but subject correctly
rejects it; those question-level reviews remain visible in the evidence.

The method requests for the clarity title are byte-identical to the previous
full-suite requests (SHA-256
`b701b8f66120ad881e81b0e55a5ba739e3dae6973e3b941c4f15d533798a9936`).
Thus today's passes do not demonstrate a fix: the same request now exceeds the
margin where earlier observations fell below it. The reported model version
is unchanged. The paired comparison supports a wording effect on the margin,
alongside between-run variation; it does not identify the provider's internal
cause or prove the review cannot recur.

The title's factual compatibility and question form consistently pass. The
uncertainty is specifically whether “structure ... for clarity” sufficiently
conveys “making captions easier to read” under the method-aware predicate.
The user's acceptance remains authoritative. This is a judge limitation, not
an observed title-generation or transcript-formatting defect.

### Decision and follow-up

Keep the qualified method rubric. Reverting globally would reintroduce a
measured false rejection of useful technique titles. Do not lower the threshold,
special-case this title, erase prior review results, or keep repeating until the
suite appears green. The complete full suite was not rerun during this diagnosis.

There is a separate reproducible shared-scorer numerical issue at
`packages/test-core/src/jev.js` in Dust Wave Platform: subtracting two decimal
probabilities can place an exact .10 margin just below the inclusive minimum.
The narrow follow-up is a shared numeric-comparison fix with equality,
immediately-above/below, tie, uncertainty and unknown-model regression cases,
followed by offline replay of retained responses before consumer adoption.
It should preserve the .10 policy and raw probabilities. Do not copy a scorer
workaround into this product. Such a fix would change only one of the six
historical clarity reviews; the other five are genuinely below the threshold.
No scorer, dependency pin, app generation or default policy changed here.

`npm run check` passes 241 tests with two existing optional skips. The diagnostic
reuses the existing synthetic corpus, immutable runner and shared client; the
offline simulator matched all 24 labels and the naive control produced exactly
12 predicted false approvals. Provider-reported input use was 19,768 tokens,
summed request time 8,427 ms and estimated inference $0.000830256 (not a bill).

Both run directories, numeric replay and source snapshots are retained in
`~/Documents/PodcastVisualizerDevelopmentEvidence/2026-09-24-clarity-investigation/`.
All 66 archived files were verified against `manifest.json`;
`synthetic-evidence.tar.gz` SHA-256 is
`aea2dc7352a0858bb1f4f9c773ed01724e83e8395f31432d3766cd8aafe3111d`.
Credentials and real project data are excluded; original evidence is preserved.
