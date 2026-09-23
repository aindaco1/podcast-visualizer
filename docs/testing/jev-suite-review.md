# Jev suite review — September 23, 2026

This is development tooling in the existing isolated investigation worktree.
No app release, provider switch, threshold reduction, or user-project rewrite
is part of this review. The earlier [fragment investigation](fragment-reflow-investigation.md)
and all its evidence remain intact.

## Acceptance policy

The user confirmed that “Caption formatting consistency” is too vague for a
chapter about readable captions that preserve meaning. A navigation title must
communicate a concrete purpose; a short useful paraphrase is sufficient. It does
not have to repeat every constraint or benefit. Grounding and question
answerability remain separate requirements.

Jev's grouping judgments were not reliable enough to certify source boundaries.
Known cue groups, timing, speaker changes and hard limits belong to exact checks.
The remaining semantic questions cover meaning, punctuation readability, title
grounding, central purpose and question answerability. This agrees with the
vendor's advice to reduce indirection and enforce structural invariants in code;
it is not a claim that their published benchmarks transfer to this application.
See [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Frozen experiment, including unsuccessful variants

Commit `5b15575` froze 16 synthetic examples, labels and two variants before
the live run. The fixture SHA-256 is
`2733f39d64d1c998b65ce855fc56f29483cdfbbdd6e9dd0b6dc06e114b5a38db`.
Each variant ran twice; the second repeat reversed variant order. Both use the
same 0.10 margin, `jev-1.13.0` recognition, shared client and $0.15 estimated
reservation limit. There were no retries, cache reuse or threshold changes.

`tmp/jev/run-4kbl7Z` completed all 64 requests / questions. It retained 32,396
reported input tokens, an estimated $0.001360632 at the existing dated rate,
and a preflight reservation of $0.086016. These estimates are not billing receipts.

| Variant, across two repeats | Correct | False passes | False failures | Review |
| --- | ---: | ---: | ---: | ---: |
| Legacy | 20 | 7 | 2 | 3 |
| Explicit cue display and stricter navigation wording | 24 | 5 | 2 | 1 |

The aggregate improvement was insufficient to adopt the variant wholesale:

- For cue readability, explicit numbering still produced five false passes out
  of sixteen judgments. It approved a cue ending in “the” before its noun in
  both repeats (pass probabilities 0.81 and 0.84). Moving this responsibility to
  deterministic grouping checks is supported by the failure, not a hidden pass.
- The stricter title question rejected all sampled vague titles, including the
  user-labeled caption title. It also rejected the valid concise question “How
  can captions remain easy to read?” twice (fail 0.57 and 0.55). Its compound
  target still bundled readability with preserving meaning. The adopted full
  suite supplies a single central purpose, retaining separate fidelity checks.
- Three case/variant pairs changed decision or leading choice across repeats.
  The complete distributions and flips remain in `report.json` and `review.md`.

The eight fresh examples were engineering probes written before the run. They
were not independently human-labeled or an untouched holdout after this review.
One user-confirmed label does not establish general calibration.

## Implemented improvements

- Combined candidate totals can no longer report a pass when an exact check
  fails. Semantic-only totals, exact disagreements and a concise review queue
  remain visible. Reports identify this as consumer schema v2.
- Eight structural controls run locally. Their expected failures must actually
  be detected; an always-passing checker fails the suite. Historical Jev false
  passes remain available in the frozen rubric experiment.
- Exact checks now reject transferring words between cue timestamps, even when
  concatenated text is unchanged. Unicode character bounds use code points,
  matching the shared reflow contract.
- Navigation controls include the user-rejected vague title, acceptable short
  questions, faithful paraphrases, and general-category titles about room tone
  and studio furnishings. Target purpose is fixture data, not a title blacklist.
- Every remote call saves an immutable pending-intent record first. A failed
  write blocks transport and reports actionable recovery while preserving the
  earlier evidence. Neither credentials nor labels enter judge requests.

The full suite retains 28 generated candidates, 20 semantic controls and eight
exact controls. It requires 48 remote requests / 67 questions, versus the prior
46 / 80. The 80-question maximum, review margin and incomplete-evidence rules
remain unchanged. Ordinary checks and previews remain offline.

## Validation

The three new reporting regressions failed against the previous harness and
passed after the fixes. The focused evaluation suite passes 26 tests. The first
full app `npm run check` passed 223 tests with three existing opt-in skips;
the final broader check passed 225 tests with the same three opt-in skips,
including navigation qualification and request-identity tests. Documentation
links and `git diff --check` also passed. No Swift or shared runtime source was
changed during this suite review; the earlier fragment candidate remains separate.

The first revised full run, `tmp/jev/run-yxbGHn`, completed all 46 requests /
61 questions with 18/18 semantic controls correct, 8/8 exact controls correct,
zero exact failures and no missing native evidence. It reported 25,389 input
tokens (dated estimate $0.001066338). Generated candidates were 26 pass / 2 fail,
and the CLI correctly exited 1.

The user then accepted both flagged generated titles as useful navigation:

| Title | Subject judgment | Human review |
| --- | --- | --- |
| Backup strategy for edits | fail 0.61, pass 0.37, uncertain 0.02 | Accept as concise navigation for preserving original recordings while editing copies. |
| How do we structure captions for clarity? | fail 0.57, pass 0.41, uncertain 0.02 | Accept as a useful paraphrase for making captions readable. |

These are judge false failures, not reasons to worsen the app's titles. Perfect
control performance on that initial set did not establish general reliability.
The user-reviewed titles are retained in the separately frozen navigation
qualification fixture and as positive controls in the full suite. Their full-suite
requests are byte-identical to those used for equivalent generated candidates;
only local labels differ.

## Navigation qualification

Commit `cdee369` froze twelve navigation examples and two variants before the
follow-up run. Six examples were fresh engineering probes. The fixture SHA-256 is
`8611d47c20758f80ecbcab303980db38c3aa2ae3d3b24a2adc0531b382ee4b21`.
The alternate question omitted the reference paragraph and asked only whether
the title communicated the intended purpose. This isolated a plausible source
of confusion; it did not earn adoption.

`tmp/jev/run-UifaC0` completed all 48 requests / questions, with 23,100 input
tokens, estimated inference $0.0009702 and reservation $0.064512. It exited 1.

| Variant, across two repeats | Correct | False passes | False failures | Review |
| --- | ---: | ---: | ---: | ---: |
| Retained source-based purpose question | 23 | 0 | 0 | 1 |
| Short candidate-only question | 20 | 2 | 2 | 0 |

The candidate-only variant accepted “Caption formatting consistency” twice and
rejected “Backup strategy for edits” twice, contradicting the user's labels.
It remains an explicit failed experiment. The retained variant accepted the
clarity paraphrase twice; its backup-title judgment changed from pass to review.
This different result from the full-context run reinforces the need to keep
known title controls identical to the generated-title requests and retain
review routing. No claim of general calibration follows from 23/24 observations.

## Final full-suite run and reviewed outcome

Commit `8c6862f` adds the two human-accepted titles as controls without changing
the retained rubric. The final synthetic fixture SHA-256 is
`33ccad2a301c1eff7ac39bc63425a440225cd238279f2e74534f6909680cd342`.
`tmp/jev/run-8mOBx2` completed 48 requests / 67 questions, with no missing native
evidence, 27,130 input tokens, estimated inference $0.00113946 and a preflight
reservation of $0.090048. Jev resolved to `jev-1.13.0`; Apple reported AFM 3 Core
on macOS 27 build 26A428. The CLI correctly exited 1.

- All eight structural controls were correct; generated outputs had zero exact
  failures. All transcript-reflow and punctuation candidates passed meaning
  checks. No semantic pass overrode an exact failure.
- Eighteen of twenty semantic controls were correct. The two false failures were
  precisely the user-accepted titles: backup subject fail/pass 0.61/0.38, clarity
  subject fail/pass 0.59/0.39. No control had a false pass or abstention.
- Generated candidates totaled 25 pass / 3 fail. The backup and clarity titles
  reproduced the known judge false failures (subject fail/pass 0.57/0.41 and
  0.61/0.37). They require no product change on that evidence.
- The remaining generated title was “Caption formatting consistency,” which the
  user rejected. Its purpose failure (fail 1.00) is a real finding under the
  agreed title policy; its grounding judgment also required review.

This completes the review of all flagged candidates from this run. It does not
turn the live gate green: two known judge false failures and one genuine vague
title remain explicit. Neither the cutoff nor labels were weakened. Improving
the app's title generation is a separate product change; strengthening Jev's
navigation reliability needs additional independently human-labeled examples
and held-out qualification, with the current cases retained as regressions.
The generic grouping responsibility remains in exact checks, and semantic
chapter judgments remain advisory.

All four live batches from this review are retained, including unsuccessful
variants. They made 206 requests / 240 questions and reported 108,015 input
tokens, estimated at $0.00453663 using the dated rate. This is an inference
estimate, not a provider billing statement. No real project data or audio left
the machine, and no release was created.

No passing development report can certify signed-app behavior, real podcast
quality or a release. The fixture set still needs independent human-labeled
validation before any claim of domain calibration.
