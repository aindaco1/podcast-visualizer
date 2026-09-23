# Short-fragment investigation — September 23, 2026

Status: investigated candidate now adopted for [1.3.4](../releases/1.3.4.md).
The release record owns publication and installed-app acceptance. The historical
1.3.3 acceptance outputs remain unchanged.
This investigation addresses the isolated “Please”, “slight.” and “clear.”
reported in [signed-app acceptance](../releases/1.3.3.md).

## Causes and candidate changes

| Fragment | Cause | Candidate behavior |
| --- | --- | --- |
| Please | Apple boundary advice kept a dependent opening separate. | Resolve a short fragment followed by lowercase continuation locally. |
| slight. | Apple advice kept the final qualification separate in signed-app acceptance; the baseline rerun merged it, demonstrating variability. | Apply the same local continuation rule. |
| clear. | Greedy grouping filled the preceding cue to the 22-word limit; merging all three source cues also exceeds the recorded duration bound. | Look one source cue ahead and retain an earlier boundary when that lets the short ending join its preceding words. |

Application sentence policy remains in `DialogueBoundaryAdviser.swift`.
Complete tokenizer-recognized sentences are checked before short continuations;
the new rule requires one side to contain at most three words and the right
side to start with a lowercase letter. Only confirmed same-speaker boundaries
with an eligible gap reach this policy. Existing abbreviation handling remains.

Generic look-ahead belongs in Platform's `@dustwave/timed-text/dialogue`.
It retains existing source boundaries and never overrides an explicit keep,
speaker change, pause, or word/character/duration bound. It also avoids merely
trading a short opening for a short ending. Text is neither rewritten nor lost.
The six-boundary batch size, Apple profile, prompt and response schema stay fixed.

This is bounded regrouping, not arbitrary phrase segmentation. The “clear” case
still has an earlier cue ending in “the”; the candidate removes the isolated
final word without inventing internal word timings. Natural phrase splitting
would require a separate investigation with aligned word-level evidence.

## Frozen Jev comparison

The hash-allowlisted synthetic fixture was committed before either live run:
`3127d8fbb643ab1f43da991d5b854f61d509ce48416044117f51e590a623137c`.
Questions, engineering labels, 0.10 review margin, model recognition and
$0.15 estimated reservation limit stayed fixed. Existing Platform Test Core
handled all remote calls. Neither recording audio nor saved project data was sent.

Both runs completed all 46 requests / 80 questions with no missing native
evidence. Apple reported AFM 3 Core, 4,096-token contexts, on macOS 27 build
26A428; Jev resolved to `jev-1.13.0`. Each run reserved an estimated $0.10752
using the existing dated reference rate, not a provider-enforced billing cap.

| Measure | Baseline `run-CD3K8X` | Candidate `run-LhiQ8p` |
| --- | --- | --- |
| Exact failures | 3 | 0 |
| Semantic candidates | 27 pass, 1 review | 27 pass, 1 review |
| Engineering controls | 17 correct, 1 review | 16 correct, 2 review |
| Reported input tokens | 28,080 | 28,066 |
| CLI exit | 1 | 1 |

All three native fragment candidates passed meaning and grouping judgments
after the fix, with grouping pass/fail probabilities of 0.76/0.23 (“Please”),
0.61/0.38 (“slight.”), and 0.80/0.20 (“clear.”). “Please” and “slight.” resolved
without model inference; the longer “clear” example still exercised inference
for its first boundary and used local advice for its short ending.

Jev alone did **not** establish the improvement. It incorrectly approved the
baseline native “Please” split (grouping pass 0.97) and both baseline “clear”
splits (pass 0.94); exact grouping assertions caught them. The deliberately
fragmented control remained review: baseline fail/pass 0.52/0.48, candidate
pass/fail 0.54/0.45. The candidate also retained review for the combined-sentence
negative control (fail/pass 0.50/0.48) and unchanged vague chapter title
“Caption formatting consistency” (subject pass/fail 0.53/0.46). Inspection
supports retaining both negative labels; the chapter title remains too vague
to serve as evidence of improved navigation. No rubric or threshold was tuned.

Raw requests, responses, distributions, source hashes, native captures and
immutable progress remain in the worktree's ignored `tmp/jev/` directories.
These are engineering regressions, not independent calibration or evidence of
general podcast quality. A completed run with reviews correctly exits 1.

## Verification and adoption boundary

A separate, entirely local replay used the saved 13-cue synthetic review from
signed-app acceptance with fresh production boundary advice. The candidate
produced five cues versus the installed app's seven: all three isolated words
were joined, with zero word-preservation, source-boundary timing, speaker,
pause or readability-bound failures. Evidence is in
`tmp/fragment-local-replay-MtR8dt/result.json`, bound to the saved input and
source hashes. The saved review, original project and approved revision were
only read; no approval, alignment or existing output was replaced. This is a
source-level replay of that input, not a new installed-app acceptance run.

- App `npm run check`: 216 passed, 3 existing opt-in skips, zero failures.
- App Swift: 131 tests passed, including the new short-continuation regressions.
- Platform `npm test`: 350 tests passed plus offline recipe checks.
- New shared tests separately exercise word, character and duration limits,
  explicit keeps, pauses, speaker changes and preservation of input objects.
- Six alternating 10,000-cue timing samples had medians of approximately
  19 ms baseline and 39 ms candidate on this Mac. The candidate adds work in
  the same bounded linear pass; no performance improvement is claimed.

The first broad checks exposed missing worktree dependencies and two unstaged
runtime manifests, not formatting failures. After installing locked Platform
dependencies and copying only missing runtime files from the installed app,
the checks above passed without skipping those runtime assertions.

At the end of this investigation, the Platform change was a local candidate against pin
`0affb6c5652611b87947bd87762d8aa17d35ea32`; its published package version and
the app version had not changed. Adoption must publish an immutable shared
package/version and pin it in the consumer before building a new app release.
Existing approved revisions must remain immutable; only a new approval can
apply different grouping. This investigation does not qualify signed-app
behavior or authorize publication.
