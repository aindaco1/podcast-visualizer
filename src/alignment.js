import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAlignmentRunnerResult } from "@dustwave/timed-text/alignment";

import { canonicalJson, sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewJson } from "./files.js";
import { loadPreparedMedia } from "./prepare.js";
import { runProcess } from "./process.js";
import { loadTranscriptById, resolveActiveTranscript } from "./review-revisions.js";
import { validateExternalAlignmentModel } from "./models.js";
import { BUNDLED_RUNTIME_ROOT, validateBundledAlignmentRuntime } from "./runtime.js";

export const ALIGNMENT_REQUEST_SCHEMA = "2";
export const ALIGNMENT_QUALITY_SCHEMA = "podcast-visualizer-alignment-quality-v1";
export const ALIGNMENT_RUNNER_REVISION = "32111c2a8dd62d891c4309f7638a86c31a789dc3";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
const RUNNER_ROOT = path.join(REPOSITORY_ROOT, "alignment-runner");
const DIGEST = /^[a-f0-9]{64}$/;

const ADAPTERS = Object.freeze({
  fixture: {
    version: "0.2.2",
    model: "fixture",
    modelVersion: "fixture-v1",
    settingsVersion: "interpolation-test-v1"
  },
  whisperx: {
    version: "3.8.6",
    model: "WAV2VEC2_ASR_BASE_960H",
    modelVersion: "488fd4f16de84438ffc945334278c1b9fb9b7159a806c1080b16111a958c945d",
    settingsVersion: "whisperx-align-ignore-interpolation-v1"
  }
});

async function readBoundedJson(filePath, maximumBytes, label) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
    throw new CliError(`${label} is missing or outside its size bound`);
  }
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

async function writeOrVerifyJson(filePath, value, label) {
  try {
    await writeNewJson(filePath, value);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readBoundedJson(filePath, 16 * 1024 * 1024, label);
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new CliError(`${label} already exists with different content`);
    }
  }
}

export async function loadApprovedTranscript(projectRoot, transcriptId, {
  projectId,
  sourceAudioSha256
} = {}) {
  if (transcriptId) {
    if (!/^transcript_[a-f0-9]{24}$/.test(transcriptId)) {
      throw new CliError("--transcript is invalid", { exitCode: EXIT.usage });
    }
    return loadTranscriptById({ projectRoot, transcriptId });
  }
  if (!projectId || !sourceAudioSha256) {
    throw new CliError("active transcript project identity is required");
  }
  const active = await resolveActiveTranscript({
    projectRoot, projectId, sourceAudioSha256, required: false
  });
  if (!active) {
    throw new CliError("an approved transcript is required", {
      exitCode: EXIT.reviewRequired,
      hint: "Run dustwave-video review and approve the transcript first."
    });
  }
  return active;
}

function adapterConfiguration(name, model) {
  const defaults = ADAPTERS[name];
  if (!defaults) throw new CliError("--adapter must be whisperx or fixture", { exitCode: EXIT.usage });
  const selectedModel = model || defaults.model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(selectedModel)
      || selectedModel.startsWith("/") || selectedModel.split("/").includes("..")) {
    throw new CliError("--model must be a safe package or model reference", { exitCode: EXIT.usage });
  }
  if (name === "whisperx" && selectedModel !== defaults.model) {
    throw new CliError(`the release build only supports the pinned ${defaults.model} alignment model`, {
      exitCode: EXIT.usage
    });
  }
  const runnerDigest = `sha256:${sha256({
    repository: "aindaco1/dust-wave-alignment-runner",
    revision: ALIGNMENT_RUNNER_REVISION,
    integration: "podcast-visualizer-alignment-v1"
  })}`;
  return { name, ...defaults, model: selectedModel, runnerDigest };
}

export async function runAlignment(projectPath, {
  adapter = "whisperx",
  model,
  transcriptId,
  uvPath = process.env.PODCAST_VISUALIZER_UV || "uv",
  runnerRoot = RUNNER_ROOT,
  allowFixture = false
} = {}) {
  if (adapter === "fixture" && !allowFixture && process.env.DUSTWAVE_ALLOW_FIXTURE_ADAPTER !== "1") {
    throw new CliError("fixture alignment is disabled outside explicit tests", { exitCode: EXIT.usage });
  }
  const prepared = await loadPreparedMedia(projectPath);
  const { transcript } = await loadApprovedTranscript(prepared.projectRoot, transcriptId, {
    projectId: prepared.manifest.projectId,
    sourceAudioSha256: prepared.prepare.analysis.sha256
  });
  if (transcript.sourceAudioSha256 !== prepared.prepare.analysis.sha256
      || Math.abs(transcript.durationMs - prepared.prepare.analysis.durationMs) > 150) {
    throw new CliError("approved transcript does not describe the prepared analysis audio");
  }
  const adapterIdentity = adapterConfiguration(adapter, model);
  const identityDigest = sha256({
    projectId: prepared.manifest.projectId,
    transcriptId: transcript.transcriptId,
    sourceAudioSha256: prepared.prepare.analysis.sha256,
    adapter: adapterIdentity
  }).slice(0, 24);
  const jobId = `job_${identityDigest}`;
  const alignmentRevisionId = `alignment_${identityDigest}`;
  const request = {
    schemaVersion: ALIGNMENT_REQUEST_SCHEMA,
    jobId,
    alignmentRevisionId,
    language: "en",
    audio: {
      path: prepared.prepare.analysis.relativePath,
      sha256: prepared.prepare.analysis.sha256,
      durationMs: prepared.prepare.analysis.durationMs
    },
    transcript: {
      contentSha256: transcript.projection.contentSha256,
      projectionSha256: transcript.projection.projectionSha256,
      cues: transcript.projection.cues
    },
    adapter: {
      name: adapterIdentity.name,
      model: adapterIdentity.model,
      modelVersion: adapterIdentity.modelVersion,
      settingsVersion: adapterIdentity.settingsVersion
    }
  };
  const alignmentDirectory = descendantPath(prepared.projectRoot, "alignment");
  await fsp.mkdir(alignmentDirectory, { recursive: true, mode: 0o700 });
  const requestPath = descendantPath(alignmentDirectory, `${alignmentRevisionId}-request.json`);
  const resultPath = descendantPath(alignmentDirectory, `${alignmentRevisionId}-result.json`);
  const qualityPath = descendantPath(alignmentDirectory, `${alignmentRevisionId}-quality.json`);
  await writeOrVerifyJson(requestPath, request, "alignment request");

  let command = uvPath;
  let commandArgs = ["run", "--directory", runnerRoot, "--python", "3.13"];
  const environment = {};
  let temporaryCache;
  if (adapter === "whisperx") {
    const [runtime, alignmentModel] = await Promise.all([
      validateBundledAlignmentRuntime(),
      validateExternalAlignmentModel()
    ]);
    command = runtime.python;
    commandArgs = [];
    temporaryCache = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-alignment-"));
    Object.assign(environment, {
      DUSTWAVE_ALIGNMENT_OFFLINE: "1",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      HF_DATASETS_OFFLINE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONPATH: [path.join(runnerRoot, "src"), runtime.sitePackages].join(path.delimiter),
      NLTK_DATA: runtime.nltkData,
      TORCH_HOME: alignmentModel.modelRoot,
      HF_HOME: path.join(temporaryCache, "huggingface"),
      XDG_CACHE_HOME: temporaryCache,
      MPLCONFIGDIR: path.join(temporaryCache, "matplotlib"),
      PATH: [path.join(BUNDLED_RUNTIME_ROOT, "bin"), process.env.PATH || "/usr/bin:/bin"].join(path.delimiter)
    });
  } else {
    environment.PYTHONPATH = path.join(runnerRoot, "src");
    environment.DUSTWAVE_ALLOW_FIXTURE_ADAPTER = "1";
  }
  const runnerArgs = [
    "-m", "dustwave_alignment_runner.cli", "run",
    "--adapter", adapter,
    "--request", requestPath,
    "--input-root", prepared.projectRoot,
    "--output", resultPath,
    "--runner-digest", adapterIdentity.runnerDigest
  ];
  commandArgs.push(...(adapter === "whisperx" ? runnerArgs : ["python", ...runnerArgs]));
  try {
    await runProcess(command, commandArgs, {
      label: `${adapter} alignment`,
      timeoutMs: adapter === "fixture" ? 2 * 60 * 1000 : 60 * 60 * 1000,
      maximumOutputBytes: 2 * 1024 * 1024,
      env: environment
    });
  } finally {
    if (temporaryCache) await fsp.rm(temporaryCache, { recursive: true, force: true });
  }
  const raw = await readBoundedJson(resultPath, 16 * 1024 * 1024, "alignment result");
  let validated;
  try {
    validated = await validateAlignmentRunnerResult(raw, {
      jobId,
      alignmentRevisionId,
      sourceAudioSha256: prepared.prepare.analysis.sha256,
      sourceDurationMs: prepared.prepare.analysis.durationMs,
      projection: transcript.projection,
      adapter: adapterIdentity
    });
  } catch (error) {
    throw new CliError("alignment result failed the shared contract", { hint: error.message });
  }
  const qualityBody = {
    schemaVersion: ALIGNMENT_QUALITY_SCHEMA,
    alignmentRevisionId,
    requestSha256: sha256(request),
    resultManifestSha256: validated.manifestSha256,
    quality: validated.quality
  };
  const quality = { ...qualityBody, manifestSha256: sha256(qualityBody) };
  await writeOrVerifyJson(qualityPath, quality, "alignment quality evidence");
  if (!validated.quality.structurallyEligible && adapter !== "fixture") {
    throw new CliError("alignment did not pass the production quality gate", {
      exitCode: EXIT.qualityGate,
      hint: `Inspect ${qualityPath}`
    });
  }
  return {
    ...prepared,
    transcript,
    request,
    requestPath,
    resultPath,
    qualityPath,
    alignment: validated
  };
}
