import { parseOptions, requireOptions } from "./args.js";
import { spawn } from "node:child_process";

import { CliError, EXIT } from "./errors.js";
import { initializeProject, loadProject } from "./project.js";
import { inspectProjectStage } from "./project-status.js";
import { loadProjectBranding, saveProjectBranding } from "./project-branding.js";
import {
  ensureBrowserReviewAudio, loadPreparedMedia, prepareProject, probeSourceMedia
} from "./prepare.js";
import { createProgressReporter, extractProgressDescriptor } from "./progress.js";
import { createReviewServer } from "./review-server.js";
import {
  approveEditedReview, loadReviewDraft, loadReviewWorkspace, readReviewEditFile,
  saveWorkingReview
} from "./review-workspace.js";
import { approvedReviewResult, summarizeApprovedTranscript } from "./transcript-summary.js";
import { resolveActiveTranscript } from "./review-revisions.js";
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
  downloadAlignmentModel, downloadParakeetModel,
  importAlignmentModel, importParakeetModel, modelStatus, verifyParakeetModel
} from "./model-management.js";
import { analyzeProject, loadSpeechAnalysis } from "./speech.js";
import {
  approveChapterEdit, exportApprovedChapters, loadChapterWorkspace,
  saveChapterWorkingCopy
} from "./chapters.js";

const HELP = `Podcast Visualizer

Usage:
  dustwave-video probe --source FILE [--json]
  dustwave-video init --source FILE --project DIRECTORY --clip START-END [--json]
  dustwave-video status --project DIRECTORY [--json]
  dustwave-video branding load --project DIRECTORY [--json]
  dustwave-video branding save --project DIRECTORY --input FILE [--json]
  dustwave-video prepare --project DIRECTORY [--json]
  dustwave-video analyze --project DIRECTORY [--parakeet-model DIRECTORY] [--maximum-speakers 6] [--expected-speakers COUNT] [--json]
  dustwave-video review --project DIRECTORY [--no-open] [--json]
  dustwave-video review load --project DIRECTORY [--json]
  dustwave-video review save --project DIRECTORY --input FILE [--json]
  dustwave-video review approve --project DIRECTORY --input FILE [--json]
  dustwave-video align --project DIRECTORY [--adapter whisperx] [--model MODEL] [--transcript ID] [--json]
  dustwave-video chapters load --project DIRECTORY [--mode topics|questions] [--json]
  dustwave-video chapters save --project DIRECTORY --input FILE [--mode topics|questions] [--json]
  dustwave-video chapters approve --project DIRECTORY --input FILE [--mode topics|questions] [--json]
  dustwave-video chapters export --project DIRECTORY [--mode topics|questions] [--format youtube|markdown|json] [--json]
  dustwave-video render --project DIRECTORY [--aspect all] [--background opaque|transparent|both] [--alpha-codec hevc|prores|both] [--title TEXT] [--style dust-subtle] [--json]
  dustwave-video models status [--parakeet-model DIRECTORY] [--json]
  dustwave-video models import parakeet-v3 --source DIRECTORY [--json]
  dustwave-video models import align-en --source DIRECTORY [--json]
  dustwave-video models download parakeet-v3 [--json]
  dustwave-video models download align-en [--json]
  dustwave-video doctor [--json]
  dustwave-video --help

Commands:
  probe     Read bounded audio metadata without creating a project.
  init      Create a new immutable project from local media.
  status    Validate and show the current project state.
  branding  Load or save local project names, speaker labels, and logo settings.
  prepare   Create immutable analysis and review audio for the selected clip.
  analyze   Transcribe with Parakeet and anonymously diarize speakers offline.
  review    Review transcript text and anonymous speakers locally or through the native app.
  align     Force-align the approved transcript to prepared audio.
  chapters  Generate, review, approve, and export local episode chapters.
  render    Render and technically verify one or all publishable aspects.
  models    Verify, discover, import, or securely download external speech models.
  doctor    Check the current development runtime.

Exit codes:
  0 success; 2 usage; 3 review required; 4 model missing;
  5 quality gate; 6 render failure.
`;

export const ERROR_SCHEMA = "podcast-visualizer-error-v1";

const SAFE_UNEXPECTED_FAILURES = Object.freeze({
  "review approve": Object.freeze({
    message: "Podcast Visualizer could not approve this transcript because of an internal error.",
    hint: "Your project and existing transcript revisions were preserved. Reopen Transcript Review and try again. If it repeats, report the app version and project stage."
  }),
  "review save": Object.freeze({
    message: "Podcast Visualizer could not save this transcript because of an internal error.",
    hint: "Your project and existing transcript revisions were preserved. Reopen Transcript Review and try again. If it repeats, report the app version and project stage."
  }),
  "chapters save": Object.freeze({
    message: "Podcast Visualizer could not save this chapter draft because of an internal error.",
    hint: "Your project, transcript, alignment, and existing chapter drafts were preserved. Reload Chapters and try again. If it repeats, report the app version and project stage."
  }),
  "chapters approve": Object.freeze({
    message: "Podcast Visualizer could not approve these chapters because of an internal error.",
    hint: "Your project, transcript, alignment, and saved chapter draft were preserved. Reload Chapters and try again. If it repeats, report the app version and project stage."
  }),
  "chapters export": Object.freeze({
    message: "Podcast Visualizer could not export these chapters because of an internal error.",
    hint: "Your approved chapters and existing exports were preserved. Retry the export. If it repeats, report the app version and project stage."
  })
});

const EXIT_CODE_NAMES = Object.freeze({
  [EXIT.failure]: "failure",
  [EXIT.usage]: "usage",
  [EXIT.reviewRequired]: "review_required",
  [EXIT.modelMissing]: "model_missing",
  [EXIT.qualityGate]: "quality_gate",
  [EXIT.renderFailure]: "render_failure"
});

function output(value, json) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

function jsonRequested(argv) {
  return argv.includes("--json");
}

export function safeUnexpectedFailure(command) {
  return SAFE_UNEXPECTED_FAILURES[command] ?? {
    message: "Podcast Visualizer could not complete this operation because of an internal error.",
    hint: "Your existing project files were preserved. Retry the operation. If it repeats, report the app version and project stage."
  };
}

function errorResult(error, command, known) {
  const exitCode = known ? error.exitCode : EXIT.failure;
  const unexpected = known ? null : safeUnexpectedFailure(command);
  const diagnostic = known && error.diagnosticCode
    ? { diagnosticCode: error.diagnosticCode }
    : {};
  return {
    schemaVersion: ERROR_SCHEMA,
    command: command || null,
    exitCode,
    error: {
      code: EXIT_CODE_NAMES[exitCode] || "failure",
      ...diagnostic,
      message: known ? error.message : unexpected.message,
      hint: known ? error.hint : unexpected.hint
    }
  };
}

async function probeCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["source", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["source"]);
  const result = await probeSourceMedia(options.source);
  output(options.json ? result : `${result.durationMs} ms of audio at ${result.sourcePath}`, options.json);
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
  const status = await inspectProjectStage(result.projectRoot, {
    projectId: result.manifest.projectId
  });
  output(options.json ? {
    projectRoot: result.projectRoot,
    projectId: result.manifest.projectId,
    state: status.state,
    sourcePath: result.sourcePath,
    sourceSha256: result.manifest.source.sha256,
    clip: result.manifest.clip,
    transcript: status.activeTranscript
      ? summarizeApprovedTranscript(status.activeTranscript)
      : null
  } : `${result.manifest.projectId}: ${status.state}`, options.json);
}

async function brandingCommand(argv) {
  const [action, ...arguments_] = argv;
  if (!["load", "save"].includes(action)) {
    throw new CliError("branding action must be load or save", { exitCode: EXIT.usage });
  }
  const options = parseOptions(arguments_, new Map([
    ["project", "value"], ...(action === "save" ? [["input", "value"]] : []), ["json", "boolean"]
  ]));
  requireOptions(options, action === "save" ? ["project", "input"] : ["project"]);
  const result = action === "save"
    ? await saveProjectBranding({ projectPath: options.project, inputPath: options.input })
    : await loadProjectBranding(options.project);
  output(options.json ? result : `${result.podcastName} · ${result.organizationName}`, options.json);
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
    analysisPath: result.analysisPath,
    reviewPath: result.reviewPath,
    manifestSha256: result.prepare.manifestSha256
  } : `Prepared ${result.prepare.analysis.durationMs} ms of analysis and review audio`, options.json);
}

async function analyzeCommand(argv, progress) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["parakeet-model", "value"], ["maximum-speakers", "value"],
    ["expected-speakers", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const maximumSpeakers = options["maximum-speakers"] === undefined
    ? 6
    : Number(options["maximum-speakers"]);
  const expectedSpeakers = options["expected-speakers"] === undefined
    ? undefined
    : Number(options["expected-speakers"]);
  const result = await analyzeProject(options.project, {
    parakeetModelPath: options["parakeet-model"],
    maximumSpeakers,
    expectedSpeakers,
    onProgress: (detail) => progress.emit("analysis.progress", detail)
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

async function browserReviewCommand(argv, progress) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["no-open", "boolean"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const project = await loadPreparedMedia(options.project);
  const draft = await loadReviewDraft(project.projectRoot);
  const active = await resolveActiveTranscript({
    projectRoot: project.projectRoot,
    projectId: project.manifest.projectId,
    sourceAudioSha256: project.prepare.analysis.sha256
  });
  const reviewAudio = await ensureBrowserReviewAudio(project);
  const server = await createReviewServer({
    projectRoot: project.projectRoot,
    projectId: project.manifest.projectId,
    sourceAudioSha256: project.prepare.analysis.sha256,
    draft,
    baseRevision: active?.transcript ?? null,
    audioPath: reviewAudio.audioPath,
    audioContentType: reviewAudio.contentType
  });
  progress.emit("review.ready", { reviewUrl: server.url, state: "review_required" });
  if (!options.json) process.stdout.write(`Review URL: ${server.url}\n`);
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
  const value = {
    reviewUrl: server.url,
    ...approvedReviewResult(result.approved)
  };
  output(options.json ? value : `Approved ${result.approved.transcriptId}`, options.json);
}

async function nativeReviewCommand(action, argv) {
  const needsInput = action === "save" || action === "approve";
  const options = parseOptions(argv, new Map([
    ["project", "value"], ...(needsInput ? [["input", "value"]] : []), ["json", "boolean"]
  ]));
  requireOptions(options, needsInput ? ["project", "input"] : ["project"]);
  const project = await loadPreparedMedia(options.project);
  const draft = await loadReviewDraft(project.projectRoot);
  const active = await resolveActiveTranscript({
    projectRoot: project.projectRoot,
    projectId: project.manifest.projectId,
    sourceAudioSha256: project.prepare.analysis.sha256
  });
  const baseRevision = active?.transcript ?? null;
  if (action === "load") {
    const speech = await loadSpeechAnalysis(project.projectRoot, project, { allowMissing: true });
    const workspace = await loadReviewWorkspace({
      projectRoot: project.projectRoot,
      draft,
      audioPath: project.reviewPath,
      baseRevision,
      speech
    });
    output(options.json ? workspace : `${workspace.cues.length} cues ready for review`, options.json);
    return;
  }
  const edit = await readReviewEditFile(options.input, draft, baseRevision);
  if (action === "save") {
    const result = await saveWorkingReview({
      projectRoot: project.projectRoot,
      draft,
      editedCues: edit.cues,
      speakers: edit.speakers,
      checkedCueIds: edit.checkedCueIds,
      baseRevision
    });
    output(options.json ? result : "Review working copy saved", options.json);
    return;
  }
  const approved = await approveEditedReview({
    projectRoot: project.projectRoot,
    projectId: project.manifest.projectId,
    sourceAudioSha256: project.prepare.analysis.sha256,
    draft,
    editedCues: edit.cues,
    speakers: edit.speakers,
    reflowBoundaryHints: edit.reflowBoundaryHints,
    baseRevision
  });
  const result = approvedReviewResult(approved);
  output(options.json ? result : `Approved ${approved.transcriptId}`, options.json);
}

async function reviewCommand(argv, progress) {
  const action = argv[0];
  if (["load", "save", "approve"].includes(action)) {
    await nativeReviewCommand(action, argv.slice(1));
    return;
  }
  await browserReviewCommand(argv, progress);
}

async function alignCommand(argv, progress) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["adapter", "value"], ["model", "value"],
    ["transcript", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  progress.emit("alignment.started", { phase: "alignment" });
  const result = await runAlignment(options.project, {
    adapter: options.adapter || "whisperx",
    model: options.model,
    transcriptId: options.transcript
  });
  progress.emit("alignment.completed", { phase: "alignment", fraction: 1 });
  output(options.json ? {
    alignmentRevisionId: result.request.alignmentRevisionId,
    resultPath: result.resultPath,
    qualityPath: result.qualityPath,
    quality: result.alignment.quality
  } : `Aligned ${result.alignment.quality.alignedWordCount}/${result.alignment.quality.wordCount} words`, options.json);
}

async function chaptersCommand(argv) {
  const [action, ...arguments_] = argv;
  if (!["load", "save", "approve", "export"].includes(action)) {
    throw new CliError("chapters action must be load, save, approve, or export", {
      exitCode: EXIT.usage
    });
  }
  const needsInput = action === "save" || action === "approve";
  const options = parseOptions(arguments_, new Map([
    ["project", "value"], ["mode", "value"],
    ...(needsInput ? [["input", "value"]] : []),
    ...(action === "export" ? [["format", "value"]] : []),
    ["json", "boolean"]
  ]));
  requireOptions(options, needsInput ? ["project", "input"] : ["project"]);
  const mode = options.mode || "topics";
  if (!["topics", "questions"].includes(mode)) {
    throw new CliError("--mode must be topics or questions", { exitCode: EXIT.usage });
  }
  if (action === "load") {
    const workspace = await loadChapterWorkspace(options.project, { mode });
    output(options.json ? workspace : `${workspace.edit.entries.length} chapter entries ready`, options.json);
    return;
  }
  if (action === "save") {
    const workspace = await saveChapterWorkingCopy(options.project, options.input, { mode });
    const result = {
      contextId: workspace.contextArtifact.contextId,
      workingPath: workspace.workingPath,
      entries: workspace.edit.entries.length
    };
    output(options.json ? result : `Saved ${result.entries} chapter entries`, options.json);
    return;
  }
  if (action === "approve") {
    const approved = await approveChapterEdit(options.project, options.input, { mode });
    const result = {
      state: "approved",
      chapterRevisionId: approved.chapterRevisionId,
      manifestSha256: approved.manifestSha256,
      revisionPath: approved.revisionPath,
      chapters: approved.list.chapters.length
    };
    output(options.json ? result : `Approved ${result.chapters} chapters`, options.json);
    return;
  }
  const exported = await exportApprovedChapters(options.project, {
    mode,
    format: options.format || "youtube"
  });
  output(options.json ? exported : exported.outputPath, options.json);
}

async function renderCommand(argv, progress) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["aspect", "value"], ["background", "value"], ["alpha-codec", "value"], ["title", "value"],
    ["style", "value"], ["adapter", "value"], ["model", "value"],
    ["transcript", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const results = await renderProject(options.project, {
    aspect: options.aspect || "all",
    background: options.background || "opaque",
    alphaCodec: options["alpha-codec"] || "hevc",
    title: options.title,
    style: options.style || "dust-subtle",
    adapter: options.adapter || "whisperx",
    model: options.model,
    transcriptId: options.transcript,
    onProgress: (detail) => progress.emit("render.progress", detail)
  });
  const value = results.map((result) => ({
    aspect: result.scene.aspect,
    background: result.manifest.codec.background,
    alphaCodec: result.manifest.codec.alphaCodec || null,
    videoCodec: result.manifest.codec.video,
    outputPath: result.outputPath,
    manifestPath: result.manifestPath,
    sha256: result.manifest.output.sha256,
    bytes: result.manifest.output.bytes,
    durationMs: result.manifest.output.durationMs,
    width: result.manifest.output.width,
    height: result.manifest.output.height,
    frameRate: result.manifest.output.frameRate,
    audioCodec: result.manifest.output.audioCodec
  }));
  output(options.json ? value : value.map((item) => {
    const profile = item.alphaCodec ? `${item.background}/${item.alphaCodec}` : item.background;
    return `Rendered ${item.aspect} ${profile}: ${item.outputPath}`;
  }).join("\n"), options.json);
}

async function modelsCommand(argv, progress) {
  const [action, ...arguments_] = argv;
  if (action === "status") {
    const options = parseOptions(arguments_, new Map([
      ["parakeet-model", "value"], ["json", "boolean"]
    ]));
    progress.emit("model.status", { phase: "verifying-model" });
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
    progress.emit("model.import", { phase: "verifying-model" });
    const result = model === "parakeet-v3"
      ? await importParakeetModel(options.source)
      : await importAlignmentModel(options.source);
    progress.emit("model.import", { phase: "installing-model", fraction: 1 });
    const value = {
      model,
      destination: result.destination,
      reused: result.reused,
      version: model === "parakeet-v3" ? result.manifest.sourceRevision : result.manifest.modelVersion
    };
    output(options.json ? value : `${result.reused ? "Verified" : "Imported"} ${model} at ${result.destination}`, options.json);
    return;
  }
  if (action === "download") {
    const [model, ...rest] = arguments_;
    if (!model || !["parakeet-v3", "align-en"].includes(model)) {
      throw new CliError("models download requires parakeet-v3 or align-en", { exitCode: EXIT.usage });
    }
    const options = parseOptions(rest, new Map([["json", "boolean"]]));
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    process.once("SIGTERM", abort);
    try {
      const result = model === "parakeet-v3"
        ? await downloadParakeetModel({
          signal: abortController.signal,
          onProgress: (detail) => progress.emit("model.download", detail)
        })
        : await downloadAlignmentModel({
          signal: abortController.signal,
          onProgress: (detail) => progress.emit("model.download", detail)
        });
      const value = {
        model,
        destination: result.destination,
        reused: result.reused,
        version: model === "parakeet-v3" ? result.manifest.sourceRevision : result.manifest.modelVersion
      };
      output(options.json ? value : `${result.reused ? "Verified" : "Downloaded"} ${model} at ${result.destination}`, options.json);
    } finally {
      process.removeListener("SIGTERM", abort);
    }
    return;
  }
  throw new CliError("models requires status, import, or download", { exitCode: EXIT.usage });
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
    checks.push({
      id: "encode-decode-smoke", ok: true,
      detail: "libass + H.264/AAC + compact HEVC/AAC alpha + ProRes 4444/PCM alpha + image QC"
    });
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
  const wantsJson = jsonRequested(argv);
  let command = argv[0];
  let progress = null;
  try {
    const [selectedCommand, ...rawRest] = argv;
    command = selectedCommand;
    if (!selectedCommand || selectedCommand === "--help" || selectedCommand === "-h" || selectedCommand === "help") {
      process.stdout.write(HELP);
      return EXIT.ok;
    }
    const extracted = extractProgressDescriptor(rawRest);
    const rest = extracted.argv;
    if (["review", "chapters"].includes(selectedCommand) && rest[0]) {
      command = `${selectedCommand} ${rest[0]}`;
    }
    progress = createProgressReporter({
      descriptor: extracted.descriptor,
      command: selectedCommand
    });
    progress.emit("command.started", {});
    if (selectedCommand === "probe") await probeCommand(rest);
    else if (selectedCommand === "init") await initCommand(rest);
    else if (selectedCommand === "status") await statusCommand(rest);
    else if (selectedCommand === "branding") await brandingCommand(rest);
    else if (selectedCommand === "prepare") await prepareCommand(rest);
    else if (selectedCommand === "analyze") await analyzeCommand(rest, progress);
    else if (selectedCommand === "review") await reviewCommand(rest, progress);
    else if (selectedCommand === "align") await alignCommand(rest, progress);
    else if (selectedCommand === "chapters") await chaptersCommand(rest);
    else if (selectedCommand === "render") await renderCommand(rest, progress);
    else if (selectedCommand === "models") await modelsCommand(rest, progress);
    else if (selectedCommand === "doctor") await doctorCommand(rest);
    else throw new CliError(`unknown command: ${selectedCommand}`, { exitCode: EXIT.usage, hint: "Run dustwave-video --help." });
    progress.emit("command.completed", {});
    return EXIT.ok;
  } catch (error) {
    const known = error instanceof CliError;
    const result = errorResult(error, command, known);
    try {
      progress?.emit("command.failed", {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.hint
      });
    } catch {
      // Preserve the original failure when the progress consumer has gone away.
    }
    if (wantsJson) {
      process.stderr.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stderr.write(`dustwave-video: ${result.error.message}\n`);
      if (result.error.hint) process.stderr.write(`hint: ${result.error.hint}\n`);
      if (!known && process.env.PODCAST_VISUALIZER_DEBUG === "1") process.stderr.write(`${error.stack}\n`);
    }
    return result.exitCode;
  }
}
