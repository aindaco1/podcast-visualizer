# Chapter quality follow-up

Development only, after 1.3.4. No release or dependency/model change.

## Frozen experiment plan — September 23, 2026

The production change asks for the central action, question or outcome and its
source-supported purpose. No title blacklist or extra inference pass is added.
The existing native capture invokes the real chapter adviser. Two unchanged
baseline runs precede two planned local candidate runs on the same three synthetic
passages, in both title modes. Two further full-suite captures accompany live
evaluation once credentials are available. This is a small reproducibility check, not a
measurement of general podcast quality.

The rubric challenger lives in `purposeRequirement` in
`scripts/jev-rubric-review.mjs`. It changes only the subject question. Reference
text, grounding/style questions, parser, Jev 1.13.0 model allowlist and 0.10
review margin remain fixed. The default rubric is unchanged unless the
comparison supports adoption. In particular, a candidate must reject vague and
factually misleading titles while retaining useful concise paraphrases.

- `--review-titles`: six development controls, including the two user-accepted
  paraphrases with the full production request context and the rejected vague
  caption title. It reuses the existing allowlisted fixtures.
- `--review-holdout`: six separately user-labeled titles in
  `title-holdout.json`. Only the purpose titles for room tone and name rehearsal
  were accepted. The assistant authored these synthetic cases; room tone is an
  existing control subject. Their exact texts/labels are reserved from live
  development scoring. This small holdout cannot calibrate general accuracy.
- Each comparison has two planned repeats per variant, reversing variant
  order on repeat two: 24 requests and 72 questions per command. No tuning
  after the held-out results, no retries, and no threshold changes.
- Two final full-suite candidate runs use fresh native generation. All findings
  and incomplete attempts remain visible. Each of the four live commands has
  a $0.15 estimated reservation limit, not a provider billing cap.

Before live work, both fixed corpora pass the same shared response validator
and application scoring path with faithful and naive simulated judges. The
naive topical-vocabulary shortcut is predicted to falsely pass exactly eight
development rows (two distinct traps, four observations each) and sixteen
held-out rows (four distinct traps). Tests assert exact IDs and demonstrate
that removing one predicted trap fails. Simulated probabilities/usage are
test data, not provider evidence.

The comparison follows TypeSafe's guidance to keep exact invariants in code
and inspect literal interpretations of criteria:
[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Evidence

Baseline `run-WxSxpJ` and `run-4tExx5` both generated
“Caption formatting consistency.” They had no exact failures or missing native
evidence and made no remote requests. Both accepted paraphrases also recurred.

### Rejected instruction-only prompt

Local runs `run-T24MgX` and `run-ewBnoK` both retained
“Caption formatting consistency.” The general instruction about action/purpose
did not fix the defect, despite zero exact failures and complete capture. That
production edit was discarded. Both runs made zero remote requests.

### Second prompt candidate

Before further generation, freeze one topic-mode request change: ask for the
main question answered or point explained, including advice's stated purpose,
without inventing or exaggerating an outcome. General instructions and question
mode return to baseline. Plan two local native captures; this additional
development experiment is prompted by the reproduced failure, not a retry of
live scoring. Judge wording, held-out cases and confidence policy stay frozen.

Local runs `run-93wG8J` and `run-gj8vIm` both generated
“How to split captions at natural phrase boundaries.” The backup topic was
“Backup necessity for edits”; microphone titles named echo reduction and
microphone placement/distance. Both captures were complete with zero exact
failures and no remote requests. This demonstrates a more concrete technique
title on this synthetic passage, not a general formatting-quality guarantee.

### Rubric qualification: challenger rejected

`run-WJpiAI` (development) and `run-aW7Brj` (held out) each completed all 24
requests/72 questions. Counts below are **12 observations per cell**, comprising
six distinct titles tested twice, not twelve independent examples.

| Partition | Rubric | Correct | False passes | False failures | Review |
|---|---|---:|---:|---:|---:|
| Development | Current | 8 | 0 | 2 | 2 |
| Development | Purpose challenger | 10 | 0 | 0 | 2 |
| User-labeled holdout | Current | 10 | 0 | 1 | 1 |
| User-labeled holdout | Purpose challenger | 8 | 0 | 2 | 2 |

The apparent development gain did not generalize even to this small holdout.
The challenger is retained only as a reproducible experiment; the default
rubric and margin remain unchanged. Neither rubric falsely approved a rejected
title in these runs. Both mishandled “Getting names right before recording,”
which the user accepted. The challenger additionally sent both room-tone
purpose observations to review. Its two accepted development paraphrases also
changed pass/review outcomes between repeats.

The complete question distributions remain in the reports. These results
support keeping human review and a separate holdout, not relaxing the threshold
or treating Jev as release acceptance. The name-rehearsal focus also combines
goal and method; a future independently labeled corpus should audit whether
focus annotations demand detail that a useful title may omit. Do not alter
these consumed holdout labels/questions to improve this run's score.

Reported input usage: 20,528 development tokens and 20,172 held-out tokens;
estimated inference $0.000862176 and $0.000847224 respectively at the runner's
dated reference rate. These are estimates, not billing receipts. Both commands
returned exit 1 for retained disagreements/reviews, not transport failure.

### Full-suite checks of the second prompt candidate

`run-nlehny` and `run-yqEkiZ` each completed 48 requests/67 questions with fresh
native capture, no missing evidence and zero exact failures. All eight exact
controls passed. Both generated the concrete caption-technique title above,
making four observations across local and live captures. Question mode still
generated the already user-accepted clarity paraphrase.

Both runs scored 26/28 candidates as pass, with one fail and one review. The
failure was the accepted clarity question; the review was the new caption
technique title's subject relevance. Topic/claim grounding and title style
passed. These findings remain visible, not overridden by a list of accepted
strings. Semantic controls matched 18/20 labels in each run: the accepted
backup title was review then fail, and the accepted clarity question failed
both times. There were no false passes in the controls.

Each run reported 27,139 input tokens, estimated $0.001139838 at the dated rate.
All four live batches totaled 144 requests, 278 questions and 94,978 reported
input tokens, estimated **$0.003989076**. No retries, cached scoring, provider
fallback, threshold relaxation or release occurred. Exit 1 in both full runs
means semantic findings still need review; the full suite is not green.

The topic-prompt change remains a development candidate. It replaced the
reproduced vague caption title with a concrete technique in these tests; a
human title-quality decision and broader real-project acceptance are separate
from exact/source checks. Real project data was never sent to Jev.

### Source verification

`npm run check`: 231 passing JavaScript tests, two existing optional skips,
syntax and secret checks passed. The native Swift suite passed 132 tests in
22 suites. Offline regressions cover unchanged production request context,
label isolation, fixture integrity, independent partitions, exact simulator
false-pass IDs, fail/review aggregation and repeat changes across all questions.
The chapter prompt test verifies JSON quoting and exclusion of internal IDs in
both modes. Ordinary tests remain offline.

A final reporting check normalizes repeated choices by question ID, so a
provider JSON-key reorder cannot create a false repeat flip. The regression
test permutes response keys. Recomputed metrics matched both preserved live
comparison reports exactly; no additional provider calls were needed.

Full local evidence, including request intents/checkpoints, distributions,
model metadata, source hashes, generated text and test logs, is preserved in
`~/Documents/PodcastVisualizerDevelopmentEvidence/2026-09-23-chapter-quality/evidence.tar.gz`.
The adjacent manifest records its SHA-256. All ten final reports were verified
byte-identical to the original run directories. This archive is local only.
