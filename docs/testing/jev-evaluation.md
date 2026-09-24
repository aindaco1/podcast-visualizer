# Jev development evaluation

This suite evaluates chapter titles and transcript reflow/readability using
synthetic text. It reuses `@dustwave/test-core/jev` for request construction,
Cloudflare transport, response validation and review routing. Podcast Visualizer
owns the fixtures, native capture, exact checks, questions and evidence.

The Jev suite is developer-only. Following the local comparison, the app's
dialogue-advice batch size was reduced from 24 to six boundaries. Version 1.3.3
also preserves complete sentence boundaries locally. The app has no Jev provider or credential. Ordinary
`npm run check` and Swift tests remain offline; the capture test is disabled
unless the developer runner explicitly enables it.

## Commands

```bash
npm ci --ignore-scripts
npm run test:jev                        # Offline request preview
npm run test:jev -- --native             # Apple inference, no remote evaluation
npm run test:jev -- --live               # Fresh Apple inference, then Jev
npm run test:jev -- --live --max-estimated-usd=0.15
npm run test:jev -- --review-rubric       # Offline frozen rubric comparison
npm run test:jev -- --review-rubric --live --max-estimated-usd=0.15
npm run test:jev -- --review-navigation  # Offline navigation qualification
npm run test:jev -- --review-navigation --live --max-estimated-usd=0.15
npm run test:jev -- --review-titles      # Full-context title rubric comparison
npm run test:jev -- --review-holdout     # Separate, user-labeled title probes
npm run test:apple:compare               # Local Apple use-case/context comparison
```

The two title modes reuse this runner and accept the same explicit `--live`
and budget flags. Their frozen plan, label provenance and results are in the
[chapter quality follow-up](chapter-quality-followup.md). Historical rubric
and navigation comparisons remain reproducible with their original fixtures.

The live command requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in
the calling environment. Use an existing authorized developer credential; keep
it out of source, command output and reports. This runner does not log in,
purchase credits, retry requests or fall back to another provider. Credentials
are read only after the complete synthetic corpus and budget pass validation,
and are excluded from the native capture subprocess.

Native capture needs macOS 26+, a ready Apple Intelligence model, Xcode and the
existing resolved Swift dependencies. It uses the same `--build-system native`
workaround as [the macOS validation script](../../scripts/ci/validate-macos.sh).
An unavailable model or missing capture is recorded as incomplete; deterministic
fallback does not count as Apple inference. Explicit sentence-preservation cases
must return a local keep hint without claiming model use. Allowlisted short-continuation
cases may also resolve locally; exact grouping checks still apply. Fix the build or model readiness and
start a new run. No requests are sent when native checks are missing.

The reservation uses 32,000 input tokens per question and a dated TypeSafe
reference rate of $0.042 per million input tokens. The default estimated limit
is $0.25, the maximum accepted limit is $1, and a batch is capped at 80 questions.
This is an estimate under that rate, **not a provider-enforced billing cap**.
Cloudflare directs current pricing checks to the account dashboard. See
[Cloudflare's model reference](https://developers.cloudflare.com/ai/models/typesafe/jev/)
and [TypeSafe's model documentation](https://docs.typesafe.ai/models).

## Coverage

- Twenty semantic controls cover faithful and deliberately flawed chapter
  titles and negation. Eight additional structural controls run locally, without
  Jev requests. Labels never enter requests. The user confirmed the vague caption
  title's negative label and two accepted generated paraphrases; other labels are
  engineering judgments. Accepted-title controls use requests identical to those
  for equivalent generated candidates, including source text and all questions.
- Eight dialogue cases call the existing shared reflow engine. Exact checks
  preserve words, their association with cue timestamps, speaker boundaries,
  long pauses and readability bounds. Jev judges meaning, not exact cue grouping.
- Three cases call the existing display-punctuation function. Exact checks
  retain word IDs, source text, speaker and timing evidence; Jev judges meaning
  and readability of the resulting text.
- Native capture invokes the production `OnDeviceChapterAdviser` in topic and
  question modes and `OnDeviceDialogueBoundaryAdviser`. Its hints feed the
  existing shared reflow engine, adding six titles and eleven reflow candidates.
  They exercise complete sentences, abbreviations, short continuations, optional
  inference and speaker/pause hard boundaries. The generic baseline intentionally
  has no application sentence-preservation hints.
  Sentence/abbreviation cases also assert exact output cue counts, and the three
  fragment cases plus continuation/negation assert exact cue groups; a semantic
  pass cannot conceal incorrect grouping. The shared limit counts Unicode code
  points, and the independent check uses the same unit.
  Chapter anchors/timing use the existing chapter compiler. Each title's judge
  reference is restricted to its own synthetic topic window.

Chapter timing is fabricated test data, not speech-alignment evidence. No media
is needed. The native bridge lives exclusively in the Swift test target; no
production logic or prompts are copied. Questions distinguish grounding, topic
coverage, question answerability and readability. Chapter navigation uses an
explicit central purpose rather than requiring every supporting detail in a title.
Reference facts cannot earn
credit when absent from a candidate. This follows
[TypeSafe's atomic-question guidance](https://docs.typesafe.ai/introduction).

## Privacy and retained evidence

The user approved a narrow development exception to the local-data rule:
allowlisted synthetic fixtures and candidates freshly derived from them may go
to Cloudflare-hosted Jev. Real media, transcripts, review data, project paths
and custom inputs remain local and are not accepted by the runner. There are no
input, project, saved-output or output-directory CLI flags.

[Synthetic fixtures](../../test/fixtures/jev/synthetic.json) are bounded and
checked against a source-controlled SHA-256 allowlist before and after native
generation. Changes require review and a deliberate hash update in
[the corpus adapter](../../scripts/jev-corpus.mjs). Symlinked fixture/evidence
paths, traversal, unknown capture fields, invented anchors and malformed hints
are rejected before authentication. Arbitrary saved outputs are not accepted.

Each invocation allocates a private, ignored `tmp/jev/run-*` directory. Existing
files are never replaced. It contains synthetic native inputs/outputs, a corpus,
request preview, immutable progress snapshots, `report.json`, `review.md` and
a local `native.log`. Reports bind fixtures, source code and candidates by
hashes and retain resolved judge model IDs, raw responses, probabilities, usage
and exact failures. Each network request also has a pending-intent file saved
before transport; a persistence failure blocks the call. API errors stop without
retry and retain partial evidence.
Native runs also retain `apple-models.json`: OS build, availability and, on
macOS 27 with Swift 6.4+, resolved model name, context size and capabilities.
Unavailable metadata is omitted, never inferred from the OS. This metadata
stays local and is not included in Jev requests.
Transport rejects redirects, bounds responses and disables gateway logging/cache
in request headers; those headers do not establish provider retention guarantees.

## Interpretation

### Full-suite review (2026-09-23; not released)

The [suite review](jev-suite-review.md) preserves the unsuccessful broad-rubric
experiment and records the adopted separation of exact checks, semantic checks
and chapter purpose. The current full corpus uses 48 requests / 67 questions,
plus eight local structural controls. Its reservation estimate is $0.090048.

Reports with `consumerSchemaVersion: podcast-jev-evaluation-v2` use combined
exact-and-semantic `candidates` totals. The older reports' `candidates` totals
were semantic only; use the new `semanticCandidates` field for that comparison.
`judgeExactDisagreements` identifies semantic passes contradicted by exact checks.
`reviewQueue` lists exact failures, control-label disagreements and semantic
failures/reviews without treating expected negative controls as product defects.

The optional `--review-rubric` mode uses a separately hash-allowlisted
[fixture](../../test/fixtures/jev/rubric-review.json), skips Apple generation and
compares the retained legacy and explicit wording twice each, reversing order on
the second repeat. Its 64 judgments are repeated measurements of 16 examples,
not 64 independent samples. It reports per-variant/domain/partition errors and
repeat flips. It preserves the unsuccessful experiment; it is not the adopted
full-suite rubric or a passing acceptance gate.

`--review-navigation` uses a separate hash-allowlisted
[fixture](../../test/fixtures/jev/navigation-review.json), comparing the retained
source-based purpose question with a rejected shorter candidate-only question.
Twelve examples run twice per variant: 48 requests / questions. It retains the
three user-reviewed title labels and six fresh engineering probes. Neither review
mode takes custom inputs, bypasses the label margin, or automatically retries.

### Local fragment investigation (2026-09-23; not released)

The [fragment investigation](fragment-reflow-investigation.md) records the frozen
before/after comparison, two small candidate fixes, passing regression checks,
and Jev's false acceptance of visibly fragmented baseline candidates. The full
then-expanded corpus had 46 requests and 80 questions; its reserved estimate was
$0.10752, so a $0.10 limit correctly rejects it before authentication.

### 1.3.3 evidence (2026-09-23)

- Shared-migration baseline `run-4wXtFP`: unchanged 31-case suite, fourteen
  controls correct and seventeen candidates passed. No exact failures or
  missing native evidence.
- Expanded run `run-gvgFDa`: fifteen controls correct, one control needing
  review, twenty-one candidates passed, one vague chapter title needing review.
  Inspection also found the judge passed a split “Dr. / Rivera” abbreviation.
  That prompted local tokenizer handling and an exact grouping assertion.
- Final `run-9eoDg7`: fixture SHA-256
  `a9f081c3fad0782185fb0ef64831ee6e0de317f47bc4ecbab118f40962f1d5dc`,
  thirty-eight requests, twenty-two candidates passed, fifteen controls correct,
  one control needing review, zero exact failures or missing native evidence.
  The combined-sentence negative control's fail/pass probabilities were
  0.53/0.45: correctly exit 1 under the unchanged 0.10 margin. Inspection confirms
  the negative label; retain this judge limitation instead of tuning away the tie.
- Production policy probe `run-0dYqKg` returned all 24 short-case hints with
  21/24 label agreement (twelve distinct pairs duplicated), versus 12/24 for the
  earlier raw content-tagging comparison. Three unfinished-phrase decisions
  remained too conservative. All 24 complete long-paragraph boundaries were
  kept locally without inference. These are engineering examples, not independent
  quality or real-podcast validation. Later abbreviation handling does not change
  those examples; the raw comparison intentionally bypasses local sentence policy.
- Stronger few-shot and atomic-boolean experiments were retained in private
  runs `run-m24gqK`, `run-TJmvPk` (failed compilation), and `run-yGSbOU`.
  Single-boundary booleans got 10/12 labels right. They did not justify replacing
  the model/profile/schema. Only the source-preserving policy was adopted.
- The fixed [speech fixture](../../test/fixtures/jev/podcast-speech.json) was
  synthesized locally with macOS Samantha and Daniel voices at rate 145,
  converted to mono 16 kHz PCM, and separated by 700 ms silence. Released and
  migrated helpers produced identical text, words, tokens, confidence, and four
  speaker turns in `tmp/speech-evaluation/run-s_ydkfve` and `run-d_iwweb0`.
  The 35.87-second audio and source hashes were preserved. Both helpers heard
  “choir” for “quieter”; no ASR accuracy gain is claimed. No audio was sent to Jev.

Release acceptance is recorded separately in [1.3.3](../releases/1.3.3.md).

`complete` means all requested judge calls completed, not that quality passed.
`releaseAccepted` is always false. The explicit live command exits `0` when all
exact checks, controls and candidates pass; `1` for exact failures, wrong control
labels, semantic failures or review; and `2` for incomplete evidence or setup
failures. An offline preview can exit zero while semantics remain unevaluated.

Near ties, uncertain answers and unknown model versions route to review. The
initial 0.10 margin and `jev-1.13.0` recognition are provisional; CutNotes'
calibration does not transfer to this domain. These controls are engineering
smoke checks, not independent validation or proof of general judge accuracy.
Freeze questions for comparisons; use new labels for later calibration instead
of weakening thresholds to hide failures. See
[TypeSafe's confidence guidance](https://docs.typesafe.ai/confidence).

The suite does not measure ASR/diarization accuracy, pixel layout, contrast,
encoder output, real podcast quality or signed-app interaction. Keep the
[existing flow matrix](user-flow-regressions.md), render smoke and human review.
Jev findings cannot authorize a release.

## Apple formatting comparison

`npm run test:apple:compare` runs a separate, entirely local experiment. It
accepts no input paths or provider credentials and uses a separately hashed
[synthetic fixture](../../test/fixtures/jev/apple-formatting.json). It reuses
the app's exact instructions, prompt serializer, response schema and generation
call through a small internal seam. The app selects `.contentTagging`,
batches at most six candidate boundaries and requests at most 1,024 response tokens.

The comparison crosses `.contentTagging` and `.general` with batch sizes 24
(historical baseline) and 6 (current app default). These sizes stay fixed when
the app default changes. Every configuration runs twice, reversing model order on the repeat. Prompt
bytes are frozen and checked across both models and repetitions. Every batch
uses a fresh session with greedy decoding and the same response-token limit.
There are two cases:

- Twelve distinct, balanced merge/keep examples repeated with new cue IDs to
  fill a 24-boundary batch. Labels stay outside model inputs. The repetitions
  and duplicated examples are not independent quality samples.
- Twenty-four adjacent boundaries with long, synthetic podcast paragraphs.
  The existing policy clips each excerpt to 320 characters. This case tests
  context capacity and decision completeness; it does not score semantics on
  truncated sentences or claim to test final rendered caption readability.

On macOS 27/Swift 6.4+, the harness captures tokenizer counts for the prompt,
instructions and schema separately, plus actual input/output usage on successful
responses. It retains model-reported context size, elapsed generation time and
sanitized errors. Component counts are diagnostics, not a guarantee that their
sum includes every framework overhead. A response budget is a ceiling, not
proof that a request fits. Timing is descriptive and includes cold-model effects.
Older supported systems still run the comparison and omit unsupported metadata.

Evidence uses the same private `tmp/jev/run-*` directories, immutable files,
source hashes and credential-stripped Swift invocation as Jev capture. Each
attempt writes `batch-NNN.json` before the next attempt, retaining both successful
and failed results if a later build/process failure interrupts the matrix.
`report.json` and `review.md` distinguish wrong labels, absent/duplicate/invented
decisions, context overflow and unavailable models. There are no automatic
retries; the two scheduled repetitions include all failures.

Exit `0` means the fixed matrix completed without these findings, `1` means
quality/completeness findings or observed context overflow, and `2` means
unavailable models, generation/setup failures or invalid evidence. A context
overflow is expected to remain visible as a failed case, even if a smaller
batch succeeds. `releaseAccepted` remains false.

This follows the useful part of CutNotes 1.0.5's approach: small bounded
decisions, preserved source text, model provenance and failures retained in
evaluation. Apple's [content-tagging guidance](https://developer.apple.com/documentation/foundationmodels/categorizing-and-organizing-data-with-content-tags)
recommends the general use case for more complex constraints;
[context-window guidance](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)
explains budgeting input and output together. Neither is evidence that a
particular use case improves this app; the comparison measures that locally.

## Shared adoption and rollback

The Platform pin advances from `6da7db044f668a481d4bac2e5c2c8d78d17a3d2d`
to `60d439b887f1244f82ff232c849d74152b28c776`, adopting Test Core 0.3.0 as a
development dependency. The complete `packages/timed-text` tree and its 0.11.1
version are unchanged. Release packaging copies only `timed-text`, excluding
Test Core and the evaluation scripts/tests.

Rollback restores the prior pointer and lockfile and removes the developer
adapter, fixtures, capture test and package script together. No user data
migration, app replacement, version bump or release is needed.
The app's six-boundary batching policy is independent of the developer tools;
removing the evaluation suite does not revert that policy.

## Initial evidence — September 23, 2026

Evaluated on Apple Silicon with macOS 27.0, Swift 6.4 and the existing local
Apple Foundation Models advisers. Jev resolved to `jev-1.13.0`.

The initial 27-request pilot classified all 10 original controls correctly;
13/17 product candidates passed, three failed and one needed review. Inspection
found that the title-topic question demanded supporting details inappropriate
for a concise navigation title. The rubric was revised to accept accurate
umbrella topics, and four new concise-title controls were added. No product
prompt, generator or threshold changed. Keep this earlier result as evaluator
development evidence, not evidence of a product regression or improvement.

The next fresh 31-request run classified all 14 controls correctly and passed
all 17 product candidates and their exact checks. Two candidate texts differed
from the first run, so this is not a controlled comparison of identical outputs.
The rubric remains provisional; the new controls were designed during evaluator
development and are not an independent validation set.

A repeat with the same questions, controls and margin also passed 14/14 controls
and 17/17 candidates with no exact failures or missing native checks. Each final
run used 31 requests and 54 questions, reserving $0.072576 under the $0.10
estimated limit. This limited repeatability check does not calibrate the judge.

Local evidence is retained under `tmp/jev/`:

- `run-n1LG51`: original rubric and 10 controls, including flagged candidates.
- `run-Yo5xgx`: concise-title rubric and 14 controls; 18,841 reported input
  tokens, $0.000791322 estimated inference at the dated reference rate.
- `run-SA3IJD`: final repeat, including empty-advice rejection; 18,833 input
  tokens, $0.000790986 estimated inference. All 31 requests completed.

Source verification passed 205 JavaScript tests with two existing optional
skips, 122 Swift tests (the live capture test is disabled in the ordinary suite),
and 347 shared-platform tests plus both clean-checkout recipe checks. Focused
tests also reject empty native advice rather than count it as inference.
No release, version bump, product-model change or user-project mutation occurred.

## Apple comparison evidence — September 23, 2026

`tmp/jev/run-yoVTcl` completed all 40 scheduled batches, covering both cases,
both use cases, both batch sizes and two repetitions. macOS reported version
27.0 build 26A428. Both use cases reported **AFM 3 Core**, a **4,096-token**
context size and guided-generation/tool-calling/vision capabilities; reasoning
was not reported. This is one machine and one OS/model version.

Both repetitions gave the same aggregate results:

| Use case | Batch size | Short-case label matches | Long-case returned decisions | Long-case result |
|---|---:|---:|---:|---|
| `.contentTagging` | 24 (default at evaluation) | 12/24 | 5/24 | Partial output without a thrown error |
| `.general` | 24 | 12/24 | 0/24 | Context window exceeded |
| `.contentTagging` | 6 | 12/24 | 24/24 | Complete |
| `.general` | 6 | 13/24 | 24/24 | Complete |

The full long-case prompt measured 3,667 tokens before instructions, schema and
response generation. The successful `.contentTagging` call reported 3,987 input
tokens and 118 output tokens, with only five decisions. Smaller long-case
prompts measured at most 936 tokens and returned all decisions. The model's
reported usage and separate component token counts have different overhead;
do not treat their sum as an exact accounting identity.

Both 24-boundary configurations chose `merge` for every short-case boundary.
The six-boundary experiment improved capacity, but `.general` matched only one
additional label out of 24. These are engineering labels on 12 distinct examples,
not validated measures of real-podcast quality. The experiment therefore does
not justify a product model switch. It supports further evaluation of smaller
or token-budgeted requests, response completeness and clearer atomic decisions
before further behavior changes. At the time of this comparison, the app still
used its original defaults; the subsequent adoption of six is recorded below.

The command intentionally exited `1` for the preserved quality/completeness
findings. No remote requests were made. Automated source checks passed 213
JavaScript tests with two optional skips, and the Swift test run passed 124
tests across 22 suites (opt-in capture tests remain disabled in ordinary runs).
The comparison is developer evidence, not release acceptance.

A fresh ordinary `--native` run, `tmp/jev/run-YYcztO`, also captured both Apple
model records and all expected native candidates with no missing or exact
failures. This was local capture only: its 14 controls and 17 candidates remain
unevaluated by Jev, and no remote requests were made.

## Six-boundary adoption — September 23, 2026

Following approval, `OnDeviceDialogueBoundaryAdviser` now sends at most six
candidate boundaries per request. It retains `.contentTagging`, the existing
instructions and response schema, greedy generation, the 1,024-token response
limit, the 120-candidate cap, cancellation and fallback behavior. Decisions are
still sanitized and returned in source order. No version bump or release was
created.

Offline regression tests exercise the actual production batching and result
aggregation with 0, 1, 6, 7, 24, 25 and 120 candidates. They verify complete
coverage, request limits, the final partial batch and source ordering when the
generator returns results in reverse order. The comparison harness retains the
fixed 24-versus-6 matrix so this default change cannot silently erase its baseline.

Six is an empirical capacity improvement on the recorded fixtures, not a token
budget guarantee for every language or transcript. The prior formatting-label
limitations remain. The 120-candidate cap now requires up to 20 sequential
requests instead of five, so complete model advice can take longer than the old
partial response. This change does not claim to improve semantic quality.

Source verification passed 213 JavaScript tests (two optional skips) and the
125-test Swift run, including all seven production-batching regression cases.

A fresh live smoke check called the actual production adviser on the allowlisted
long-context fixture through `JevCaptureTests`. It returned **24/24 unique,
ordered decisions**, with `usedOnDeviceModel: true` and no missing/invalid
decisions. Evidence is retained in `tmp/jev/run-Qdt1zS`, including source/input/
output hashes and Apple model metadata. The model was AFM 3 Core on macOS 27.0
build 26A428. This check made no remote requests and did not score semantic quality.
