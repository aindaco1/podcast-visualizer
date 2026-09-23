import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJevRequest, judgeJevResponse } from "@dustwave/test-core/jev";
import { writeNewJson } from "../src/files.js";
import { FIXTURE, loadFixtures, localCorpus, nativeInput, nativeCorpus, reflowFailures, readBoundedFile, validateAppleMetadata } from "../scripts/jev-corpus.mjs";
import { POLICY, RECOVERY, parseOptions, reserveBudget, summarize, exitCode, credentials, createRun, main } from "../scripts/jev-evaluation.mjs";

const fixtures = await loadFixtures();
const corpus = localCorpus(fixtures);
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-jev-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function capture() {
  const input = nativeInput(fixtures);
  return {
    chapters: input.chapters.map((row) => ({ id: row.id,
      entries: row.context.context.windows.map((window, index) => ({
        anchorId: window.records[0].anchorId, title: row.id === "topics" ? fixtures.chapters[index].good : `How can we discuss ${fixtures.chapters[index].id}?`
      })), usedOnDeviceModel: true, skippedWindows: 0, error: "" })),
    dialogue: input.dialogue.map((row, index) => {
      const fixture = fixtures.dialogue[index];
      const hints = row.cues.slice(0, -1).flatMap((cue, i) =>
        cue.speakerLabel === row.cues[i + 1].speakerLabel && fixture.gapMs <= 900
          ? [{ afterCueId: cue.id, action: fixture.sentenceAction || "merge" }] : []);
      return { id: row.id, hints, usedOnDeviceModel: hints.length > 0 && !fixture.sentenceAction && !fixture.allowLocalAdvice, error: "" };
    })
  };
}
const appleModels = { osVersion: "Synthetic test OS", models: ["general", "contentTagging"].map((useCase) => ({ useCase, available: true })) };
const nativeAdapter = (value = capture()) => async (directory) => {
  await writeNewJson(path.join(directory, "native-output.json"), value);
  await writeNewJson(path.join(directory, "apple-models.json"), appleModels);
};
function response(payload, choice = "pass", model = "jev-1.13.0") {
  return { model, usage: { input_tokens: 10, output_tokens: 1 }, answers: Object.fromEntries(
    Object.keys(payload.input.questions).map((key) => [key, { type: "choice", choice,
      probabilities: { pass: choice === "pass" ? 0.98 : 0.01, fail: choice === "fail" ? 0.98 : 0.01, uncertain: 0.01 }
    }])) };
}

test("Jev accepts explicit bounded modes and rejects arbitrary source/project/output paths", () => {
  assert.deepEqual(parseOptions([]), { live: false, native: false, reviewRubric: false, reviewNavigation: false, maximum: 0.25 });
  assert.equal(parseOptions(["--live"]).native, true);
  for (const args of [["--project=/private"], ["--input=../secret"], ["--output-dir=x"], ["--live", "--dry-run"], ["--live", "--live"], ["--max-estimated-usd=0"], ["--max-estimated-usd=2"], ["--max-estimated-usd=NaN"]]) {
    assert.throws(() => parseOptions(args));
  }
});

test("synthetic allowlist rejects changed content and symlinked files or parents", async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "test/fixtures/jev"), { recursive: true });
  await fs.writeFile(path.join(root, FIXTURE), "private source");
  await assert.rejects(loadFixtures(root), /allowlist/);
  await fs.unlink(path.join(root, FIXTURE));
  await fs.symlink(import.meta.filename, path.join(root, FIXTURE));
  await assert.rejects(loadFixtures(root), /Symlinked/);
  await fs.symlink(path.join(root, "test/fixtures/jev"), path.join(root, "linked"));
  await assert.rejects(readBoundedFile(root, "linked/synthetic.json"), /Symlinked/);
  await assert.rejects(readBoundedFile(root, "../secret"), /Unsafe/);
  await assert.rejects(readBoundedFile(root, "/secret"), /Unsafe/);
});

test("local corpus exercises current reflow and punctuation with independent exact invariants", () => {
  assert.equal(corpus.filter((row) => row.kind === "control").length, 28);
  assert.equal(corpus.filter((row) => row.exactOnly).length, 8);
  assert.ok(corpus.filter((row) => !row.exactOnly).every((row) => row.deterministicFailures.length === 0));
  assert.equal(corpus.find((row) => row.id === "deterministic-negation").candidate, "speaker-01: We should not delete the original recording.");
  const input = [{ startsAtMs: 0, endsAtMs: 1000, speakerLabel: "speaker-01", textMarkdown: "Do not delete it." }];
  assert.ok(reflowFailures(input, [{ ...input[0], textMarkdown: "Delete it." }]).includes("word-preservation"));
  assert.ok(reflowFailures(input, [{ ...input[0], speakerLabel: "speaker-02" }]).includes("speaker-boundary"));
  assert.ok(reflowFailures(input, [{ ...input[0], startsAtMs: 1 }]).includes("timing"));
});

test("native corpus binds title evidence to its own topic window and uses actual boundary decisions", () => {
  const result = nativeCorpus(fixtures, capture());
  assert.deepEqual(result.missing, []);
  assert.equal(result.cases.length, 17);
  assert.ok(result.cases.every((row) => row.deterministicFailures.length === 0));
  const chapter = result.cases.find((row) => row.id === "chapter-topics-microphones");
  assert.equal(chapter.reference, fixtures.chapters[0].text);
  assert.ok(!chapter.reference.includes(fixtures.chapters[1].text));
  const changed = capture();
  changed.dialogue.find((row) => row.id === "continuation").hints[0].action = "keep";
  assert.notEqual(nativeCorpus(fixtures, changed).cases.at(-4).candidate, result.cases.at(-4).candidate);
  const splitAbbreviation = capture();
  splitAbbreviation.dialogue.find((row) => row.id === "abbreviation").hints[0].action = "keep";
  assert.deepEqual(nativeCorpus(fixtures, splitAbbreviation).cases.find((row) => row.id === "native-reflow-abbreviation").deterministicFailures, ["sentence-grouping"]);
});

test("human-accepted title controls use byte-identical requests to equivalent generated candidates", () => {
  for (const fixture of fixtures.chapters) for (const accepted of fixture.acceptedTitles || []) {
    const value = capture();
    value.chapters.find((row) => row.id === accepted.mode).entries[fixtures.chapters.indexOf(fixture)].title = accepted.title;
    const generated = nativeCorpus(fixtures, value).cases.find((row) => row.id === `chapter-${accepted.mode}-${fixture.id}`);
    const control = corpus.find((row) => row.id === `control-approved-${fixture.id}-${accepted.mode}`);
    assert.equal(control.expected, "pass");
    assert.deepEqual(createJevRequest(control.candidate, control.requirements, { reference: control.reference }),
      createJevRequest(generated.candidate, generated.requirements, { reference: generated.reference }));
  }
});

test("native fallback, missing titles, invalid anchors and unexpected fields cannot become silent passes", () => {
  const unavailable = capture();
  unavailable.chapters[0].usedOnDeviceModel = false;
  unavailable.dialogue.find((row) => row.id === "fragment-clear").usedOnDeviceModel = false;
  assert.deepEqual(nativeCorpus(fixtures, unavailable).missing, ["chapters-topics", "dialogue-fragment-clear"]);
  const empty = capture();
  empty.dialogue.find((row) => row.id === "continuation").hints = [];
  assert.deepEqual(nativeCorpus(fixtures, empty).missing, ["dialogue-continuation"]);
  const absent = capture();
  absent.chapters[0].entries.pop();
  assert.ok(nativeCorpus(fixtures, absent).cases[2].deterministicFailures.includes("chapter-title-missing"));
  for (const mutate of [
    (value) => { value.private = "secret"; },
    (value) => { value.chapters[0].entries[0].anchorId = "../../secret"; },
    (value) => { value.dialogue[0].hints[0].action = "rewrite"; },
    (value) => { const row = value.dialogue.find((row) => row.id === "fragment-clear"); row.hints[1] = row.hints[0]; },
    (value) => { value.dialogue.find((row) => row.id === "question-answer").hints = [{ afterCueId: "cue_000001", action: "merge" }]; },
    (value) => { value.dialogue.find((row) => row.id === "complete-sentences").usedOnDeviceModel = true; },
    (value) => { value.dialogue.pop(); }
  ]) { const value = capture(); mutate(value); assert.throws(() => nativeCorpus(fixtures, value)); }
});

test("question and estimated spending budgets reject before authentication", async (t) => {
  assert.ok(reserveBudget(corpus, 0.25).questions > 0);
  assert.throws(() => reserveBudget(corpus, 0.000001), /budget/);
  let authenticated = false;
  await assert.rejects(main(["--live", "--max-estimated-usd=0.000001"], {
    root: await temporary(t), captureNative: nativeAdapter(), credentials: () => { authenticated = true; }
  }), /budget/);
  assert.equal(authenticated, false);
});

test("dry run never authenticates or calls a provider and remains semantically incomplete", async (t) => {
  const root = await temporary(t);
  const forbidden = () => { throw new Error("must not be called"); };
  assert.equal(await main([], { root, credentials: forbidden, call: forbidden, captureNative: forbidden }), 0);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.complete, false);
  assert.equal(report.releaseAccepted, false);
  assert.ok(report.summary.candidates.unevaluated > 0);
});

test("tampered native output stops before credentials or network", async (t) => {
  const value = capture(); value.unexpected = "private";
  let auth = 0;
  await assert.rejects(main(["--live"], { root: await temporary(t), captureNative: nativeAdapter(value), credentials: () => { auth++; } }), /Unexpected/);
  assert.equal(auth, 0);
});

test("remote failure stops without retry, preserves evidence and presents safe recovery", async (t) => {
  const root = await temporary(t);
  let calls = 0;
  const code = await main(["--live"], { root, captureNative: nativeAdapter(), credentials: () => ({ accountId: "a".repeat(32), token: "hidden" }),
    call: () => { calls++; throw new Error("private-token-and-path"); } });
  assert.equal(code, 2);
  assert.equal(calls, 1);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = await fs.readFile(path.join(root, "tmp/jev", run, "report.json"), "utf8");
  assert.ok(report.includes(RECOVERY.remote));
  assert.ok(!report.includes("private-token-and-path"));
  assert.ok((await fs.readdir(path.join(root, "tmp/jev", run))).includes("preview.json"));
  const pending = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "request-000-pending.json")));
  assert.match(pending.requestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(pending.caseId, corpus[0].id);
});

test("failure to persist request intent blocks transport and preserves the earlier evidence", async (t) => {
  const root = await temporary(t);
  let calls = 0;
  const code = await main(["--live"], { root, credentials: () => ({}),
    captureNative: async (directory) => {
      await nativeAdapter()(directory);
      await writeNewJson(path.join(directory, "request-000-pending.json"), { preserved: true });
    }, call: () => { calls++; throw new Error("Must not call"); } });
  assert.equal(code, 2);
  assert.equal(calls, 0);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.error, RECOVERY.preparation);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "request-000-pending.json"))), { preserved: true });
});

test("live evaluation with correct control decisions succeeds without sending labels or metadata", async (t) => {
  const root = await temporary(t);
  const fullCorpus = [...corpus, ...nativeCorpus(fixtures, capture()).cases];
  let calls = 0;
  const code = await main(["--live"], { root, captureNative: nativeAdapter(), credentials: () => ({ token: "hidden" }),
    call: (payload) => {
      calls++;
      assert.deepEqual(Object.keys(payload).sort(), ["input", "model"]);
      assert.deepEqual(Object.keys(payload.input.state).sort(), ["candidate", "reference"]);
      assert.ok(!JSON.stringify(payload).includes('"expected"'));
      const source = fullCorpus.find((row) => row.candidate === payload.input.state.candidate && row.reference === payload.input.state.reference);
      return response(payload, source.expected || "pass");
    }
  });
  assert.equal(code, 0);
  assert.equal(calls, fullCorpus.filter((row) => !row.exactOnly).length);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.summary.controls.correct, 20);
  assert.equal(report.summary.exactControls.correct, 8);
  assert.equal(report.summary.candidates.pass, 28);
  assert.equal(report.releaseAccepted, false);
  assert.equal(report.policyCalibrated, false);
  assert.deepEqual(report.appleModels, appleModels);
  assert.ok(Object.values(report.sourceHashes).every((hash) => /^[a-f0-9]{64}$/u.test(hash)));
  assert.ok(!JSON.stringify(report).includes("hidden"));
});

test("Apple metadata preserves older-OS unknowns and rejects invented fields and invalid context limits", () => {
  assert.deepEqual(validateAppleMetadata(appleModels), appleModels);
  assert.equal(appleModels.models[0].contextSize, undefined);
  for (const mutate of [
    (value) => { value.models[0].privatePath = "/private"; },
    (value) => { value.models[0].contextSize = 0; },
    (value) => { value.models[0].capabilities = ["imaginary"]; },
    (value) => { value.models[1].useCase = "general"; }
  ]) { const value = structuredClone(appleModels); mutate(value); assert.throws(() => validateAppleMetadata(value)); }
});

test("an always-passing judge fails deliberately flawed controls and gives review guidance", async (t) => {
  const root = await temporary(t);
  assert.equal(await main(["--live"], { root, captureNative: nativeAdapter(), credentials: () => ({}), call: (payload) => response(payload) }), 1);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const report = JSON.parse(await fs.readFile(path.join(root, "tmp/jev", run, "report.json")));
  assert.equal(report.summary.controls.falsePasses, 9);
  assert.equal(report.guidance, RECOVERY.quality);
});

test("missing native evidence prevents authentication and cannot be counted as a passing fallback", async (t) => {
  let auth = 0;
  assert.equal(await main(["--live"], { root: await temporary(t),
    captureNative: () => { throw new Error("private build detail"); }, credentials: () => { auth++; }
  }), 2);
  assert.equal(auth, 0);
});

test("missing authentication retains the preview with actionable, redacted failure", async (t) => {
  assert.throws(() => credentials({}), /preserved/);
  const root = await temporary(t);
  assert.equal(await main(["--live"], { root, captureNative: nativeAdapter(), credentials: () => { throw new Error("private credential"); } }), 2);
  const [run] = await fs.readdir(path.join(root, "tmp/jev"));
  const text = await fs.readFile(path.join(root, "tmp/jev", run, "review.md"), "utf8");
  assert.ok(text.includes(RECOVERY.authentication));
  assert.ok(!text.includes("private credential"));
});

test("quality failures, review decisions and exact failures cannot pass the explicit live command", () => {
  const report = { complete: true, cases: [] };
  const summary = summarize(report, corpus);
  assert.equal(exitCode(report, summary, { live: true }), 1);
  assert.equal(exitCode({ ...report, complete: false }, summary, { live: true }), 2);
  assert.equal(exitCode(report, { ...summary, deterministicFailures: 1 }, { live: false }), 1);
  for (const message of Object.values(RECOVERY)) {
    assert.match(message, /preserved/);
    assert.match(message, /[Cc]heck|[Ss]et|[Cc]onfirm|[Ii]nspect/);
  }
});

test("shared judge review policy handles unknown models, near ties and malformed answers", () => {
  const payload = { input: { questions: { grounding: {} } } };
  assert.equal(judgeJevResponse(response(payload, "pass", "new-model"), payload.input.questions, POLICY).findings.grounding.decision, "review");
  const near = response(payload);
  near.answers.grounding.probabilities = { pass: 0.51, fail: 0.48, uncertain: 0.01 };
  assert.equal(judgeJevResponse(near, payload.input.questions, POLICY).findings.grounding.decision, "review");
  const malformed = response(payload); delete malformed.answers.grounding;
  assert.throws(() => judgeJevResponse(malformed, payload.input.questions, POLICY));
});

test("runs are private, distinct and refuse symlinked evidence roots or overwritten evidence", async (t) => {
  const root = await temporary(t);
  const first = await createRun(root), second = await createRun(root);
  assert.notEqual(first, second);
  assert.equal((await fs.stat(first)).mode & 0o777, 0o700);
  const file = path.join(first, "report.json");
  await writeNewJson(file, { original: true });
  await assert.rejects(writeNewJson(file, { replaced: true }));
  assert.deepEqual(JSON.parse(await fs.readFile(file)), { original: true });
  const other = await temporary(t);
  await fs.symlink(root, path.join(other, "tmp"));
  await assert.rejects(createRun(other), /Unsafe/);
});
