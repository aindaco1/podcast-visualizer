import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { descendantPath, hashFile, regularFile, writeNewJson } from "./files.js";
import { loadProject } from "./project.js";
import { runProcess } from "./process.js";
import { defaultToolPath } from "./runtime.js";

export const PREPARE_SCHEMA = "podcast-visualizer-media-preparation-v1";
export const PREPARE_FILE = "prepare.json";
const REVIEW_PROXY_SCHEMA = "podcast-visualizer-browser-review-audio-v1";
const REVIEW_PROXY_FILE = "source/review-browser.json";
const REVIEW_PROXY_AUDIO = "source/review-browser.wav";

const DIGEST = /^[a-f0-9]{64}$/;
const EXPECTED_KEYS = new Set([
  "schemaVersion", "projectId", "sourceSha256", "clip", "toolchain",
  "analysis", "review", "manifestSha256"
]);

function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(3);
}

function temporaryPath(directory, name) {
  return path.join(directory, `.${name}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
}

async function probeMedia(filePath, ffprobePath) {
  const result = await runProcess(ffprobePath, [
    "-v", "error",
    "-protocol_whitelist", "file,pipe",
    "-show_entries", "format=duration:stream=index,codec_name,codec_type,sample_rate,channels",
    "-of", "json",
    filePath
  ], { label: "ffprobe", timeoutMs: 60_000 });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new CliError("ffprobe returned invalid metadata");
  }
  const durationSeconds = Number(parsed?.format?.duration);
  const audio = parsed?.streams?.find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !audio) {
    throw new CliError("source media has no supported audio stream");
  }
  return {
    durationMs: Math.round(durationSeconds * 1000),
    codec: String(audio.codec_name ?? ""),
    sampleRate: Number(audio.sample_rate) || null,
    channels: Number(audio.channels) || null
  };
}

async function ffmpegVersion(ffmpegPath) {
  const result = await runProcess(ffmpegPath, ["-version"], {
    label: "ffmpeg version check",
    timeoutMs: 10_000,
    maximumOutputBytes: 64 * 1024
  });
  const line = result.stdout.split("\n")[0]?.trim();
  if (!line || line.length > 240) throw new CliError("ffmpeg version is invalid");
  return line;
}

async function preparedFile(projectRoot, relativePath, expected) {
  const absolute = descendantPath(projectRoot, relativePath);
  const file = await regularFile(absolute, "prepared media");
  if (file.stat.size !== expected.bytes || await hashFile(absolute) !== expected.sha256) {
    throw new CliError(`prepared media changed after creation: ${relativePath}`);
  }
  return absolute;
}

export function validatePrepareManifest(value, projectManifest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("media preparation manifest is invalid");
  }
  for (const key of Object.keys(value)) {
    if (!EXPECTED_KEYS.has(key)) throw new CliError(`media preparation contains unknown field: ${key}`);
  }
  if (value.schemaVersion !== PREPARE_SCHEMA
      || value.projectId !== projectManifest.projectId
      || value.sourceSha256 !== projectManifest.source.sha256
      || JSON.stringify(value.clip) !== JSON.stringify(projectManifest.clip)) {
    throw new CliError("media preparation identity is invalid");
  }
  if (!value.toolchain || typeof value.toolchain.ffmpeg !== "string" || value.toolchain.ffmpeg.length > 240) {
    throw new CliError("media preparation toolchain is invalid");
  }
  for (const [name, expectedPaths] of [
    ["analysis", new Set(["source/analysis.wav"])],
    ["review", new Set(["source/review.wav", "source/review.m4a"])]
  ]) {
    const item = value[name];
    if (!item || !expectedPaths.has(item.relativePath) || !Number.isSafeInteger(item.bytes) || item.bytes < 1
        || !DIGEST.test(item.sha256) || !Number.isSafeInteger(item.durationMs) || item.durationMs < 1
        || !Number.isSafeInteger(item.sampleRate) || item.sampleRate < 8000
        || !Number.isSafeInteger(item.channels) || item.channels < 1 || item.channels > 8) {
      throw new CliError(`media preparation ${name} output is invalid`);
    }
  }
  const reviewFormatValid = value.review.relativePath === "source/review.m4a"
    ? value.review.sampleRate === 48000 && value.review.channels === 2
    : value.review.sampleRate === 16000 && value.review.channels === 1;
  if (value.analysis.sampleRate !== 16000 || value.analysis.channels !== 1 || !reviewFormatValid) {
    throw new CliError("media preparation output formats are invalid");
  }
  const toleranceMs = 150;
  if (Math.abs(value.analysis.durationMs - projectManifest.clip.durationMs) > toleranceMs
      || Math.abs(value.review.durationMs - projectManifest.clip.durationMs) > toleranceMs) {
    throw new CliError("prepared media duration does not match the requested clip");
  }
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("media preparation hash does not match");
  return value;
}

export async function loadPreparedMedia(projectPath) {
  const project = await loadProject(projectPath);
  const manifestPath = descendantPath(project.projectRoot, PREPARE_FILE);
  let manifest;
  try {
    manifest = validatePrepareManifest(JSON.parse(await fsp.readFile(manifestPath, "utf8")), project.manifest);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("media preparation is missing or invalid", {
      hint: "Run dustwave-video prepare first."
    });
  }
  const analysisPath = await preparedFile(project.projectRoot, manifest.analysis.relativePath, manifest.analysis);
  const reviewPath = await preparedFile(project.projectRoot, manifest.review.relativePath, manifest.review);
  return { ...project, prepare: manifest, analysisPath, reviewPath };
}

function validateReviewProxy(value, prepared) {
  const keys = new Set(["schemaVersion", "sourceReviewSha256", "toolchain", "audio", "manifestSha256"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.has(key))
      || value.schemaVersion !== REVIEW_PROXY_SCHEMA
      || value.sourceReviewSha256 !== prepared.prepare.review.sha256
      || typeof value.toolchain?.ffmpeg !== "string" || value.toolchain.ffmpeg.length > 240
      || value.audio?.relativePath !== REVIEW_PROXY_AUDIO
      || value.audio?.codec !== "pcm_s16le" || value.audio?.sampleRate !== 16000
      || value.audio?.channels !== 1
      || !Number.isSafeInteger(value.audio?.bytes) || value.audio.bytes < 1
      || !Number.isSafeInteger(value.audio?.durationMs) || value.audio.durationMs < 1
      || !DIGEST.test(value.audio?.sha256)) {
    throw new CliError("browser review audio manifest is invalid");
  }
  const { manifestSha256, ...body } = value;
  if (manifestSha256 !== sha256(body)) throw new CliError("browser review audio hash does not match");
  return value;
}

export async function ensureBrowserReviewAudio(prepared, {
  ffmpegPath = defaultToolPath("ffmpeg"),
  ffprobePath = defaultToolPath("ffprobe")
} = {}) {
  if (prepared.prepare.review.relativePath === "source/review.wav") {
    return { audioPath: prepared.reviewPath, contentType: "audio/wav" };
  }
  const manifestPath = descendantPath(prepared.projectRoot, REVIEW_PROXY_FILE);
  const outputPath = descendantPath(prepared.projectRoot, REVIEW_PROXY_AUDIO);
  const loadExisting = async () => {
    try {
      const manifest = validateReviewProxy(JSON.parse(await fsp.readFile(manifestPath, "utf8")), prepared);
      const audioPath = await preparedFile(prepared.projectRoot, manifest.audio.relativePath, manifest.audio);
      return { audioPath, contentType: "audio/wav", manifest };
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("browser review audio cache is invalid");
    }
  };
  const manifestStat = await fsp.lstat(manifestPath).catch(() => null);
  const outputStat = await fsp.lstat(outputPath).catch(() => null);
  if (manifestStat || outputStat) {
    if (!manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()
        || !outputStat || outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw new CliError("browser review audio cache is incomplete or unsafe");
    }
    return await loadExisting();
  }

  const sourceDirectory = descendantPath(prepared.projectRoot, "source");
  const temporary = temporaryPath(sourceDirectory, "review-browser.wav");
  let linked = false;
  try {
    await runProcess(ffmpegPath, [
      "-nostdin", "-v", "error", "-n",
      "-protocol_whitelist", "file,pipe",
      "-i", prepared.reviewPath,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-c:a", "pcm_s16le", "-f", "wav", temporary
    ], { label: "browser review audio preparation", timeoutMs: 30 * 60 * 1000 });
    const [file, probe, version, digest] = await Promise.all([
      regularFile(temporary, "browser review audio"),
      probeMedia(temporary, ffprobePath),
      ffmpegVersion(ffmpegPath),
      hashFile(temporary)
    ]);
    if (probe.codec !== "pcm_s16le" || probe.sampleRate !== 16000 || probe.channels !== 1
        || Math.abs(probe.durationMs - prepared.prepare.review.durationMs) > 150) {
      throw new CliError("browser review audio format is invalid");
    }
    await fsp.chmod(temporary, 0o600);
    await fsp.link(temporary, outputPath);
    linked = true;
    const body = {
      schemaVersion: REVIEW_PROXY_SCHEMA,
      sourceReviewSha256: prepared.prepare.review.sha256,
      toolchain: { ffmpeg: version },
      audio: {
        relativePath: REVIEW_PROXY_AUDIO,
        bytes: file.stat.size,
        sha256: digest,
        durationMs: probe.durationMs,
        codec: probe.codec,
        sampleRate: probe.sampleRate,
        channels: probe.channels
      }
    };
    const manifest = { ...body, manifestSha256: sha256(body) };
    validateReviewProxy(manifest, prepared);
    await writeNewJson(manifestPath, manifest);
    return { audioPath: outputPath, contentType: "audio/wav", manifest };
  } catch (error) {
    if (linked) await fsp.unlink(outputPath).catch(() => {});
    throw error;
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

export async function prepareProject(projectPath, {
  ffmpegPath = defaultToolPath("ffmpeg"),
  ffprobePath = defaultToolPath("ffprobe")
} = {}) {
  const project = await loadProject(projectPath);
  const manifestPath = descendantPath(project.projectRoot, PREPARE_FILE);
  try {
    await fsp.lstat(manifestPath);
    return await loadPreparedMedia(project.projectRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const sourceProbe = await probeMedia(project.sourcePath, ffprobePath);
  if (project.manifest.clip.endsAtMs > sourceProbe.durationMs + 100) {
    throw new CliError("requested clip extends beyond the source duration");
  }
  const sourceDirectory = descendantPath(project.projectRoot, "source");
  const analysisPath = descendantPath(project.projectRoot, "source", "analysis.wav");
  const reviewPath = descendantPath(project.projectRoot, "source", "review.wav");
  const analysisTemporary = temporaryPath(sourceDirectory, "analysis.wav");
  const reviewTemporary = temporaryPath(sourceDirectory, "review.wav");
  const start = seconds(project.manifest.clip.startsAtMs);
  const duration = seconds(project.manifest.clip.durationMs);

  try {
    await runProcess(ffmpegPath, [
      "-nostdin", "-v", "error", "-n",
      "-protocol_whitelist", "file,pipe",
      "-ss", start, "-t", duration, "-i", project.sourcePath,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_f32le", "-f", "wav", analysisTemporary,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-c:a", "pcm_s16le", "-f", "wav", reviewTemporary
    ], { label: "ffmpeg media preparation", timeoutMs: 30 * 60 * 1000 });
    const analysis = await regularFile(analysisTemporary, "analysis audio");
    const review = await regularFile(reviewTemporary, "review audio");
    const [analysisProbe, reviewProbe, version, analysisSha256, reviewSha256] = await Promise.all([
      probeMedia(analysisTemporary, ffprobePath),
      probeMedia(reviewTemporary, ffprobePath),
      ffmpegVersion(ffmpegPath),
      hashFile(analysisTemporary),
      hashFile(reviewTemporary)
    ]);
    if (analysisProbe.codec !== "pcm_f32le" || reviewProbe.codec !== "pcm_s16le") {
      throw new CliError("prepared media codecs are invalid");
    }
    await fsp.chmod(analysisTemporary, 0o600);
    await fsp.chmod(reviewTemporary, 0o600);
    await fsp.link(analysisTemporary, analysisPath);
    try {
      await fsp.link(reviewTemporary, reviewPath);
    } catch (error) {
      await fsp.unlink(analysisPath).catch(() => {});
      throw error;
    }
    const body = {
      schemaVersion: PREPARE_SCHEMA,
      projectId: project.manifest.projectId,
      sourceSha256: project.manifest.source.sha256,
      clip: project.manifest.clip,
      toolchain: { ffmpeg: version },
      analysis: {
        relativePath: "source/analysis.wav",
        bytes: analysis.stat.size,
        sha256: analysisSha256,
        durationMs: analysisProbe.durationMs,
        sampleRate: analysisProbe.sampleRate,
        channels: analysisProbe.channels
      },
      review: {
        relativePath: "source/review.wav",
        bytes: review.stat.size,
        sha256: reviewSha256,
        durationMs: reviewProbe.durationMs,
        sampleRate: reviewProbe.sampleRate,
        channels: reviewProbe.channels
      }
    };
    const manifest = { ...body, manifestSha256: sha256(body) };
    validatePrepareManifest(manifest, project.manifest);
    await writeNewJson(manifestPath, manifest);
    return { ...project, prepare: manifest, analysisPath, reviewPath };
  } finally {
    await fsp.unlink(analysisTemporary).catch(() => {});
    await fsp.unlink(reviewTemporary).catch(() => {});
  }
}
