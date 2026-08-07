import { parseOptions, requireOptions } from "./args.js";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";

import { CliError, EXIT } from "./errors.js";
import { descendantPath } from "./files.js";
import { initializeProject, loadProject } from "./project.js";
import { prepareProject } from "./prepare.js";
import { validateReviewDraft } from "./review.js";
import { createReviewServer } from "./review-server.js";
import { runAlignment } from "./alignment.js";
import { renderProject } from "./render.js";
import {
  smokeTestBundledRuntime, validateBundledAlignmentRuntime,
  validateBundledNodeRuntime, validateBundledSpeechRuntime
} from "./runtime.js";
import {
  DEFAULT_PARAKEET_MODEL_ROOT, validateBundledDiarizationModel, validateExternalAlignmentModel
} from "./models.js";
import {
  importAlignmentModel, importParakeetModel, modelStatus, verifyParakeetModel
} from "./model-management.js";
import { analyzeProject } from "./speech.js";

const HELP = `Podcast Visualizer

Usage:
  dustwave-video init --source FILE --project DIRECTORY --clip START-END [--json]
  dustwave-video status --project DIRECTORY [--json]
  dustwave-video prepare --project DIRECTORY [--json]
  dustwave-video analyze --project DIRECTORY [--parakeet-model DIRECTORY] [--maximum-speakers 6] [--json]
  dustwave-video review --project DIRECTORY [--no-open]
  dustwave-video align --project DIRECTORY [--adapter whisperx] [--model MODEL] [--transcript ID] [--json]
  dustwave-video render --project DIRECTORY [--aspect all] [--title TEXT] [--style dust-subtle] [--json]
  dustwave-video models status [--parakeet-model DIRECTORY] [--json]
  dustwave-video models import parakeet-v3 --source DIRECTORY [--json]
  dustwave-video models import align-en --source DIRECTORY [--json]
  dustwave-video doctor [--json]
  dustwave-video --help

Commands:
  init      Create a new immutable project from local media.
  status    Validate and show the current project state.
  prepare   Create immutable analysis and review audio for the selected clip.
  analyze   Transcribe with Parakeet and anonymously diarize speakers offline.
  review    Review transcript text and anonymous speakers locally.
  align     Force-align the approved transcript to prepared audio.
  render    Render and technically verify one or all publishable aspects.
  models    Verify or securely import external speech models.
  doctor    Check the current development runtime.

Exit codes:
  0 success; 2 usage; 3 review required; 4 model missing;
  5 quality gate; 6 render failure.
`;

function output(value, json) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

async function initCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["source", "value"], ["project", "value"], ["clip", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["source", "project", "clip"]);
  const result = await initializeProject(options);
  output(options.json ? {
    projectRoot: result.projectRoot,
    projectId: result.manifest.projectId,
    state: result.manifest.state,
    manifestSha256: result.manifest.manifestSha256
  } : `Initialized ${result.manifest.projectId} at ${result.projectRoot}`, options.json);
}

async function statusCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const result = await loadProject(options.project);
  const reviewDirectory = descendantPath(result.projectRoot, "review");
  const entries = await fsp.readdir(reviewDirectory).catch(() => []);
  const state = entries.some((name) => /^transcript_[a-f0-9]{24}-approved\.json$/.test(name))
    ? "approved"
    : entries.includes("draft.json") ? "review_required" : result.manifest.state;
  output(options.json ? {
    projectRoot: result.projectRoot,
    projectId: result.manifest.projectId,
    state,
    sourceSha256: result.manifest.source.sha256,
    clip: result.manifest.clip
  } : `${result.manifest.projectId}: ${state}`, options.json);
}

async function prepareCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const result = await prepareProject(options.project);
  output(options.json ? {
    projectRoot: result.projectRoot,
    analysis: result.prepare.analysis,
    review: result.prepare.review,
    manifestSha256: result.prepare.manifestSha256
  } : `Prepared ${result.prepare.analysis.durationMs} ms of analysis and review audio`, options.json);
}

async function analyzeCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["parakeet-model", "value"], ["maximum-speakers", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const maximumSpeakers = options["maximum-speakers"] === undefined
    ? 6
    : Number(options["maximum-speakers"]);
  const result = await analyzeProject(options.project, {
    parakeetModelPath: options["parakeet-model"],
    maximumSpeakers
  });
  const value = {
    speechPath: result.speechPath,
    speakersPath: result.speakersPath,
    draftPath: result.draftPath,
    words: result.speech.transcript.words.length,
    speakers: result.speakers.speakers.length,
    cues: result.draft.cues.length
  };
  output(options.json ? value : `Analyzed ${value.words} words, ${value.speakers} speakers, and ${value.cues} review cues`, options.json);
}

async function reviewCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["no-open", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const project = await loadProject(options.project);
  const draftPath = descendantPath(project.projectRoot, "review", "draft.json");
  let draft;
  try {
    draft = validateReviewDraft(JSON.parse(await fsp.readFile(draftPath, "utf8")));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("review draft is missing or invalid", {
      hint: "Run dustwave-video analyze before review."
    });
  }
  const proxy = descendantPath(project.projectRoot, "source", "review.m4a");
  const audioPath = await fsp.stat(proxy).then(() => proxy).catch(() => project.sourcePath);
  const server = await createReviewServer({
    projectRoot: project.projectRoot,
    draft,
    audioPath
  });
  process.stdout.write(`Review URL: ${server.url}\n`);
  if (!options["no-open"]) {
    const child = spawn("/usr/bin/open", [server.url], {
      shell: false,
      stdio: "ignore",
      detached: true
    });
    child.unref();
  }
  const stop = () => server.close().catch(() => {});
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const result = await server.closed;
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (result.error) throw new CliError("review server stopped unexpectedly");
  if (!result.approved) {
    throw new CliError("review closed before approval", {
      exitCode: EXIT.reviewRequired,
      hint: "Run dustwave-video review again to continue."
    });
  }
  process.stdout.write(`Approved ${result.approved.transcriptId}\n`);
}

async function alignCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["adapter", "value"], ["model", "value"],
    ["transcript", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const result = await runAlignment(options.project, {
    adapter: options.adapter || "whisperx",
    model: options.model,
    transcriptId: options.transcript
  });
  output(options.json ? {
    alignmentRevisionId: result.request.alignmentRevisionId,
    resultPath: result.resultPath,
    qualityPath: result.qualityPath,
    quality: result.alignment.quality
  } : `Aligned ${result.alignment.quality.alignedWordCount}/${result.alignment.quality.wordCount} words`, options.json);
}

async function renderCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["aspect", "value"], ["title", "value"],
    ["style", "value"], ["adapter", "value"], ["model", "value"],
    ["transcript", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const results = await renderProject(options.project, {
    aspect: options.aspect || "all",
    title: options.title,
    style: options.style || "dust-subtle",
    adapter: options.adapter || "whisperx",
    model: options.model,
    transcriptId: options.transcript
  });
  const value = results.map((result) => ({
    aspect: result.scene.aspect,
    outputPath: result.outputPath,
    manifestPath: result.manifestPath,
    sha256: result.manifest.output.sha256
  }));
  output(options.json ? value : value.map((item) => `Rendered ${item.aspect}: ${item.outputPath}`).join("\n"), options.json);
}

async function modelsCommand(argv) {
  const [action, ...arguments_] = argv;
  if (action === "status") {
    const options = parseOptions(arguments_, new Map([
      ["parakeet-model", "value"], ["json", "boolean"]
    ]));
    const result = await modelStatus({ parakeetModelRoot: options["parakeet-model"] });
    output(options.json ? result : result.checks.map((check) =>
      `${check.ok ? "ok" : "missing"} ${check.id}: ${check.detail}`).join("\n"), options.json);
    return;
  }
  if (action === "import") {
    const [model, ...rest] = arguments_;
    if (!model || !["parakeet-v3", "align-en"].includes(model)) {
      throw new CliError("models import requires parakeet-v3 or align-en", { exitCode: EXIT.usage });
    }
    const options = parseOptions(rest, new Map([["source", "value"], ["json", "boolean"]]));
    requireOptions(options, ["source"]);
    const result = model === "parakeet-v3"
      ? await importParakeetModel(options.source)
      : await importAlignmentModel(options.source);
    const value = {
      model,
      destination: result.destination,
      reused: result.reused,
      version: model === "parakeet-v3" ? result.manifest.sourceRevision : result.manifest.modelVersion
    };
    output(options.json ? value : `${result.reused ? "Verified" : "Imported"} ${model} at ${result.destination}`, options.json);
    return;
  }
  throw new CliError("models requires status or import", { exitCode: EXIT.usage });
}

async function doctorCommand(argv) {
  const options = parseOptions(argv, new Map([["json", "boolean"]]));
  const major = Number(process.versions.node.split(".")[0]);
  const checks = [
    { id: "node", ok: major >= 22, detail: process.version },
    { id: "platform", ok: process.platform === "darwin", detail: process.platform },
    { id: "architecture", ok: process.arch === "arm64", detail: process.arch }
  ];
  try {
    const runtime = await smokeTestBundledRuntime();
    checks.push({ id: "bundled-runtime", ok: true, detail: runtime.manifestSha256 });
    checks.push({ id: "encode-decode-smoke", ok: true, detail: "libass + H.264 VideoToolbox + AAC + JPEG QC" });
  } catch (error) {
    checks.push({ id: "bundled-runtime", ok: false, detail: error.message });
  }
  try {
    const node = await validateBundledNodeRuntime();
    checks.push({ id: "node-runtime", ok: true, detail: `${node.version}, macOS ${node.minimumMacOS}+` });
  } catch (error) {
    checks.push({ id: "node-runtime", ok: false, detail: error.message });
  }
  try {
    const speech = await validateBundledSpeechRuntime();
    checks.push({ id: "speech-sidecar", ok: true, detail: `Record ${speech.recordRevision.slice(0, 12)}, FluidAudio ${speech.fluidAudio.version}` });
  } catch (error) {
    checks.push({ id: "speech-sidecar", ok: false, detail: error.message });
  }
  try {
    const model = await validateBundledDiarizationModel();
    checks.push({ id: "diarization-model", ok: true, detail: model.manifest.source.revision.slice(0, 12) });
  } catch (error) {
    checks.push({ id: "diarization-model", ok: false, detail: error.message });
  }
  try {
    const runtime = await validateBundledAlignmentRuntime();
    checks.push({ id: "alignment-runtime", ok: true, detail: `Python ${runtime.pythonVersion}, WhisperX ${runtime.whisperxVersion}` });
  } catch (error) {
    checks.push({ id: "alignment-runtime", ok: false, detail: error.message });
  }
  try {
    const model = await validateExternalAlignmentModel();
    checks.push({ id: "alignment-model", ok: true, detail: `${model.manifest.model} ${model.manifest.modelVersion.slice(0, 12)}` });
  } catch (error) {
    checks.push({ id: "alignment-model", ok: false, detail: error.message });
  }
  try {
    const model = await verifyParakeetModel(
      process.env.PODCAST_VISUALIZER_PARAKEET_MODEL || DEFAULT_PARAKEET_MODEL_ROOT
    );
    checks.push({ id: "parakeet-model", ok: true, detail: `${model.manifest.model} ${model.manifest.sourceRevision.slice(0, 12)}` });
  } catch (error) {
    checks.push({ id: "parakeet-model", ok: false, detail: error.message });
  }
  const result = { ok: checks.every((check) => check.ok), checks };
  output(options.json ? result : checks.map((check) => `${check.ok ? "ok" : "fail"} ${check.id}: ${check.detail}`).join("\n"), options.json);
  if (!result.ok) throw new CliError("development runtime is not release-compatible");
}

export async function runCli(argv) {
  try {
    const [command, ...rest] = argv;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(HELP);
      return EXIT.ok;
    }
    if (command === "init") await initCommand(rest);
    else if (command === "status") await statusCommand(rest);
    else if (command === "prepare") await prepareCommand(rest);
    else if (command === "analyze") await analyzeCommand(rest);
    else if (command === "review") await reviewCommand(rest);
    else if (command === "align") await alignCommand(rest);
    else if (command === "render") await renderCommand(rest);
    else if (command === "models") await modelsCommand(rest);
    else if (command === "doctor") await doctorCommand(rest);
    else throw new CliError(`unknown command: ${command}`, { exitCode: EXIT.usage, hint: "Run dustwave-video --help." });
    return EXIT.ok;
  } catch (error) {
    const known = error instanceof CliError;
    process.stderr.write(`dustwave-video: ${known ? error.message : "unexpected failure"}\n`);
    if (known && error.hint) process.stderr.write(`hint: ${error.hint}\n`);
    if (!known && process.env.PODCAST_VISUALIZER_DEBUG === "1") process.stderr.write(`${error.stack}\n`);
    return known ? error.exitCode : EXIT.failure;
  }
}
