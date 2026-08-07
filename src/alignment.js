import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAlignmentRunnerResult } from "@dustwave/timed-text/alignment";

import { canonicalJson, sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { descendantPath, writeNewJson } from "./files.js";
import { loadPreparedMedia } from "./prepare.js";
import { runProcess } from "./process.js";
import { validateReviewedRevision } from "./review.js";

export const ALIGNMENT_REQUEST_SCHEMA = "2";
export const ALIGNMENT_QUALITY_SCHEMA = "podcast-visualizer-alignment-quality-v1";
export const ALIGNMENT_RUNNER_REVISION = "32111c2a8dd62d891c4309f7638a86c31a789dc3";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
const RUNNER_ROOT = path.join(REPOSITORY_ROOT, "alignment-runner");
const DIGEST = /^[a-f0-9]{64}$/;
const TRANSCRIPT_FILE = /^(transcript_[a-f0-9]{24})-approved\.json$/;

const ADAPTERS = Object.freeze({
  fixture: {
    version: "0.2.2",
    model: "fixture",
    modelVersion: "fixture-v1",
    settingsVersion: "interpolation-test-v1"
  },
  whisperx: {
    version: "3.8.6",
    model: "default",
    modelVersion: "whisperx-default-en-v1",
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

export async function loadApprovedTranscript(projectRoot, transcriptId) {
  const reviewDirectory = descendantPath(projectRoot, "review");
  const entries = await fsp.readdir(reviewDirectory).catch(() => []);
  const approved = entries.filter((name) => TRANSCRIPT_FILE.test(name)).sort();
  let name;
  if (transcriptId) {
    if (!/^transcript_[a-f0-9]{24}$/.test(transcriptId)) {
      throw new CliError("--transcript is invalid", { exitCode: EXIT.usage });
    }
    name = `${transcriptId}-approved.json`;
    if (!approved.includes(name)) throw new CliError("requested approved transcript was not found");
  } else if (approved.length === 1) {
    [name] = approved;
  } else if (approved.length === 0) {
    throw new CliError("an approved transcript is required", {
      exitCode: EXIT.reviewRequired,
      hint: "Run dustwave-video review and approve the transcript first."
    });
  } else {
    throw new CliError("multiple approved transcripts exist", {
      exitCode: EXIT.usage,
      hint: "Select one with --transcript transcript_<id>."
    });
  }
  const filePath = descendantPath(reviewDirectory, name);
  const transcript = await validateReviewedRevision(await readBoundedJson(
    filePath, 8 * 1024 * 1024, "approved transcript"
  ));
  return { transcript, filePath };
}

function adapterConfiguration(name, model) {
  const defaults = ADAPTERS[name];
  if (!defaults) throw new CliError("--adapter must be whisperx or fixture", { exitCode: EXIT.usage });
  const selectedModel = model || defaults.model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(selectedModel)
      || selectedModel.startsWith("/") || selectedModel.split("/").includes("..")) {
    throw new CliError("--model must be a safe package or model reference", { exitCode: EXIT.usage });
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
  uvPath = process.env.PODCAST_VISUALIZER_UV || "/Users/aindaco1/.local/bin/uv",
  runnerRoot = RUNNER_ROOT,
  allowFixture = false
} = {}) {
  if (adapter === "fixture" && !allowFixture && process.env.DUSTWAVE_ALLOW_FIXTURE_ADAPTER !== "1") {
    throw new CliError("fixture alignment is disabled outside explicit tests", { exitCode: EXIT.usage });
  }
  const prepared = await loadPreparedMedia(projectPath);
  const { transcript } = await loadApprovedTranscript(prepared.projectRoot, transcriptId);
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

  const uvArgs = [
    "run", "--directory", runnerRoot, "--python", "3.13"
  ];
  if (adapter === "whisperx") uvArgs.push("--extra", "whisperx");
  uvArgs.push(
    "python", "-m", "dustwave_alignment_runner.cli", "run",
    "--adapter", adapter,
    "--request", requestPath,
    "--input-root", prepared.projectRoot,
    "--output", resultPath,
    "--runner-digest", adapterIdentity.runnerDigest
  );
  await runProcess(uvPath, uvArgs, {
    label: `${adapter} alignment`,
    timeoutMs: adapter === "fixture" ? 2 * 60 * 1000 : 60 * 60 * 1000,
    maximumOutputBytes: 2 * 1024 * 1024,
    env: adapter === "fixture" ? { DUSTWAVE_ALLOW_FIXTURE_ADAPTER: "1" } : undefined
  });
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
