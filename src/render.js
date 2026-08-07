import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAlignment } from "./alignment.js";
import { compileAss } from "./ass.js";
import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { copyNewFile, descendantPath, hashFile, regularFile, writeNewFile, writeNewJson } from "./files.js";
import { runProcess } from "./process.js";
import { ASPECT_PRESETS, buildScene, validateScene } from "./scene.js";
import { defaultToolPath } from "./runtime.js";

export const RENDER_SCHEMA = "transcript-video-render-v1";
export const RENDER_SETTINGS_VERSION = "videotoolbox-aac-24fps-v1";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
const FONT_ASSETS = Object.freeze([
  { source: "resources/fonts/Inter.ttf", sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031" },
  { source: "resources/fonts/IBMPlexMono-Regular.ttf", sha256: "6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46" }
]);

function temporaryMp4(directory, renderId) {
  return path.join(directory, `.${renderId}.tmp-${randomBytes(8).toString("hex")}.mp4`);
}

function rational(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ""));
  if (!match || Number(match[2]) === 0) return NaN;
  return Number(match[1]) / Number(match[2]);
}

async function toolVersion(toolPath, label) {
  const result = await runProcess(toolPath, ["-version"], {
    label: `${label} version check`, timeoutMs: 10_000, maximumOutputBytes: 64 * 1024
  });
  const version = result.stdout.split("\n")[0]?.trim();
  if (!version || version.length > 240) throw new CliError(`${label} version is invalid`);
  return version;
}

async function verifyRenderTools(ffmpegPath, ffprobePath) {
  const [ffmpeg, ffprobe, filters, encoders] = await Promise.all([
    toolVersion(ffmpegPath, "ffmpeg"),
    toolVersion(ffprobePath, "ffprobe"),
    runProcess(ffmpegPath, ["-hide_banner", "-filters"], {
      label: "ffmpeg filter check", timeoutMs: 10_000, maximumOutputBytes: 2 * 1024 * 1024
    }),
    runProcess(ffmpegPath, ["-hide_banner", "-encoders"], {
      label: "ffmpeg encoder check", timeoutMs: 10_000, maximumOutputBytes: 2 * 1024 * 1024
    })
  ]);
  if (!/^\s*[TSC\.]{2,4}\s+ass\s/m.test(filters.stdout)
      || !/h264_videotoolbox/.test(encoders.stdout)
      || !/^\s*V[\.A-Z]{5}\s+.*\bmjpeg\b/m.test(encoders.stdout)
      || !/^\s*A[\.A-Z]{5}\s+.*\baac\b/m.test(encoders.stdout)) {
    throw new CliError("ffmpeg lacks the required libass, VideoToolbox, MJPEG, or AAC capability", {
      exitCode: EXIT.renderFailure,
      hint: "Run the packaged build script or set PODCAST_VISUALIZER_FFMPEG and PODCAST_VISUALIZER_FFPROBE."
    });
  }
  return { ffmpeg, ffprobe };
}

async function stageFonts(projectRoot) {
  const fontsDirectory = descendantPath(projectRoot, "runtime", "fonts");
  await fsp.mkdir(fontsDirectory, { recursive: true, mode: 0o700 });
  const fonts = [];
  for (const asset of FONT_ASSETS) {
    const source = path.join(REPOSITORY_ROOT, asset.source);
    if (await hashFile(source) !== asset.sha256) throw new CliError(`bundled font hash is invalid: ${asset.source}`);
    const destination = descendantPath(fontsDirectory, path.basename(asset.source));
    try {
      await copyNewFile(source, destination);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await hashFile(destination) !== asset.sha256) throw new CliError(`staged font changed: ${destination}`);
    }
    fonts.push({ relativePath: path.relative(projectRoot, destination), sha256: asset.sha256 });
  }
  return fonts;
}

async function writeSceneArtifacts(projectRoot, scene) {
  validateScene(scene);
  const scenesDirectory = descendantPath(projectRoot, "scenes");
  await fsp.mkdir(scenesDirectory, { recursive: true, mode: 0o700 });
  const scenePath = descendantPath(scenesDirectory, `${scene.sceneId}.json`);
  const assPath = descendantPath(scenesDirectory, `${scene.sceneId}.ass`);
  const ass = compileAss(scene);
  for (const [filePath, content, label] of [
    [scenePath, `${JSON.stringify(scene, null, 2)}\n`, "scene manifest"],
    [assPath, ass, "ASS scene"]
  ]) {
    try {
      await writeNewFile(filePath, content);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await fsp.readFile(filePath, "utf8") !== content) throw new CliError(`${label} already exists with different content`);
    }
  }
  return { scenePath, assPath, assSha256: sha256(ass) };
}

async function probeOutput(outputPath, ffprobePath) {
  const result = await runProcess(ffprobePath, [
    "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", outputPath
  ], { label: "render QC probe", timeoutMs: 20 * 60 * 1000, maximumOutputBytes: 2 * 1024 * 1024 });
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new CliError("render QC probe returned invalid JSON");
  }
  const video = value.streams?.find((stream) => stream.codec_type === "video");
  const audio = value.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new CliError("render is missing video or audio", { exitCode: EXIT.renderFailure });
  return {
    durationMs: Math.round(Number(value.format?.duration) * 1000),
    width: Number(video.width),
    height: Number(video.height),
    frameRate: rational(video.avg_frame_rate),
    frameCount: Number(video.nb_read_frames || video.nb_frames),
    videoCodec: String(video.codec_name),
    pixelFormat: String(video.pix_fmt),
    colorRange: String(video.color_range || "unknown"),
    colorSpace: String(video.color_space || "unknown"),
    colorTransfer: String(video.color_transfer || "unknown"),
    colorPrimaries: String(video.color_primaries || "unknown"),
    audioCodec: String(audio.codec_name),
    sampleRate: Number(audio.sample_rate),
    channels: Number(audio.channels)
  };
}

function validateProbe(probe, scene) {
  const expectedFrames = Math.round(scene.durationMs / 1000 * scene.frameRate);
  const durationDeltaMs = Math.abs(probe.durationMs - scene.durationMs);
  const failures = [];
  if (probe.width !== scene.layout.width || probe.height !== scene.layout.height) failures.push("dimensions");
  if (Math.abs(probe.frameRate - 24) > 0.001) failures.push("frame-rate");
  if (Math.abs(probe.frameCount - expectedFrames) > 1) failures.push("frame-count");
  if (durationDeltaMs > 100) failures.push("duration");
  if (probe.videoCodec !== "h264" || probe.pixelFormat !== "yuv420p") failures.push("video-codec");
  if (probe.audioCodec !== "aac" || probe.sampleRate !== 48000 || probe.channels !== 2) failures.push("audio-codec");
  if (!["bt709", "unknown"].includes(probe.colorSpace)
      || !["bt709", "unknown"].includes(probe.colorTransfer)
      || !["bt709", "unknown"].includes(probe.colorPrimaries)) failures.push("color-metadata");
  return {
    passed: failures.length === 0,
    failures,
    expectedFrames,
    durationDeltaMs
  };
}

async function captureQcFrames({ ffmpegPath, inputPath, projectRoot, renderId, scene }) {
  const directory = descendantPath(projectRoot, "qc");
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const times = qcFrameTimes(scene);
  const frames = [];
  for (const item of times) {
    const relativePath = `qc/${renderId}-${item.label}.jpg`;
    const outputPath = descendantPath(projectRoot, relativePath);
    if (!await fsp.stat(outputPath).catch(() => null)) {
      await runProcess(ffmpegPath, [
        "-nostdin", "-v", "error", "-n", "-ss", (item.milliseconds / 1000).toFixed(3),
        "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2", "-c:v", "mjpeg",
        "-q:v", "2", "-f", "image2", outputPath
      ], { label: `QC frame ${item.label}`, timeoutMs: 2 * 60 * 1000 });
      await fsp.chmod(outputPath, 0o600);
    }
    const file = await regularFile(outputPath, `QC frame ${item.label}`);
    frames.push({ label: item.label, atMs: item.milliseconds, relativePath, bytes: file.stat.size, sha256: await hashFile(outputPath) });
  }
  return frames;
}

function qcFrameTimes(scene) {
  const times = [
    { label: "title", milliseconds: Math.round(scene.title.endsAtMs / 2) },
  ];
  for (const speaker of scene.speakers) {
    const cue = scene.cues.find((item) => item.speakerId === speaker.id);
    if (cue) times.push({
      label: speaker.id,
      milliseconds: Math.min(cue.endsAtMs - 1, cue.words[0].startsAtMs + 100)
    });
  }
  const longestCue = [...scene.cues].sort((left, right) =>
    (right.endsAtMs - right.startsAtMs) - (left.endsAtMs - left.startsAtMs))[0];
  times.push({
    label: "longest-cue",
    milliseconds: Math.round((longestCue.startsAtMs + longestCue.endsAtMs) / 2)
  });
  const fastestWord = scene.cues.flatMap(({ words }) => words).sort((left, right) =>
    (left.endsAtMs - left.startsAtMs) - (right.endsAtMs - right.startsAtMs))[0];
  times.push({
    label: "fastest-word",
    milliseconds: Math.round((fastestWord.startsAtMs + fastestWord.endsAtMs) / 2)
  });
  if (scene.cues.length > 1) {
    times.push({
      label: "cue-transition",
      milliseconds: Math.min(scene.cues[1].endsAtMs - 1, scene.cues[1].startsAtMs + 50)
    });
  }
  times.push({ label: "final", milliseconds: Math.max(0, scene.durationMs - 250) });
  return times;
}

async function renderScene({ aligned, scene, ffmpegPath, ffprobePath, runtime }) {
  const projectRoot = aligned.projectRoot;
  const fonts = await stageFonts(projectRoot);
  const artifacts = await writeSceneArtifacts(projectRoot, scene);
  const codec = {
    settingsVersion: RENDER_SETTINGS_VERSION,
    video: "h264_videotoolbox",
    videoBitrate: scene.layout.bitrate,
    pixelFormat: "yuv420p",
    audio: "aac",
    audioBitrate: "192k",
    frameRate: 24,
    color: "bt709"
  };
  const renderId = `render_${sha256({
    sceneManifestSha256: scene.manifestSha256,
    runtime,
    codec,
    fonts
  }).slice(0, 24)}`;
  const rendersDirectory = descendantPath(projectRoot, "renders");
  await fsp.mkdir(rendersDirectory, { recursive: true, mode: 0o700 });
  const relativeOutputPath = `renders/${renderId}-${scene.aspect.replace(":", "x")}.mp4`;
  const outputPath = descendantPath(projectRoot, relativeOutputPath);
  const manifestPath = descendantPath(rendersDirectory, `${renderId}.json`);
  const existingManifest = await fsp.readFile(manifestPath, "utf8").catch(() => null);
  if (existingManifest) {
    const manifest = JSON.parse(existingManifest);
    const output = await regularFile(outputPath, "rendered video");
    if (output.stat.size !== manifest.output.bytes || await hashFile(outputPath) !== manifest.output.sha256) {
      throw new CliError("rendered video changed after verification");
    }
    return { scene, manifest, manifestPath, outputPath };
  }

  const temporary = temporaryMp4(rendersDirectory, renderId);
  let workingOutput = outputPath;
  const preexisting = await fsp.stat(outputPath).catch(() => null);
  if (!preexisting) {
    workingOutput = temporary;
    const filter = `[0:v]ass=filename=scenes/${scene.sceneId}.ass:fontsdir=runtime/fonts,format=yuv420p[v];[1:a]adelay=${scene.title.endsAtMs}:all=1[a]`;
    await runProcess(ffmpegPath, [
      "-nostdin", "-v", "error", "-n",
      "-f", "lavfi", "-i", `color=c=0x060609:s=${scene.layout.width}x${scene.layout.height}:r=24:d=${(scene.durationMs / 1000).toFixed(3)}`,
      "-protocol_whitelist", "file,pipe", "-i", aligned.prepare.review.relativePath,
      "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
      "-map_metadata", "-1", "-r", "24", "-c:v", "h264_videotoolbox", "-b:v", codec.videoBitrate,
      "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", "-t", (scene.durationMs / 1000).toFixed(3), "-f", "mp4", temporary
    ], { cwd: projectRoot, label: `render ${scene.aspect}`, timeoutMs: 4 * 60 * 60 * 1000, maximumOutputBytes: 4 * 1024 * 1024 });
  }
  try {
    const probe = await probeOutput(workingOutput, ffprobePath);
    const quality = validateProbe(probe, scene);
    if (!quality.passed) {
      throw new CliError(`render failed technical QC: ${quality.failures.join(", ")}`, { exitCode: EXIT.renderFailure });
    }
    if (!preexisting) {
      await fsp.chmod(temporary, 0o600);
      await fsp.link(temporary, outputPath);
      workingOutput = outputPath;
    }
    const frames = await captureQcFrames({ ffmpegPath, inputPath: workingOutput, projectRoot, renderId, scene });
    const output = await regularFile(workingOutput, "rendered video");
    const body = {
      schemaVersion: RENDER_SCHEMA,
      renderId,
      sceneId: scene.sceneId,
      sceneManifestSha256: scene.manifestSha256,
      assSha256: artifacts.assSha256,
      runtime,
      fonts,
      codec,
      output: {
        relativePath: relativeOutputPath,
        bytes: output.stat.size,
        sha256: await hashFile(workingOutput),
        ...probe
      },
      quality: { ...quality, qcFrames: frames }
    };
    const manifest = { ...body, manifestSha256: sha256(body) };
    await writeNewJson(manifestPath, manifest);
    return { scene, manifest, manifestPath, outputPath };
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

export async function renderProject(projectPath, {
  aspect = "all",
  title,
  style = "dust-subtle",
  adapter = "whisperx",
  model,
  transcriptId,
  ffmpegPath = defaultToolPath("ffmpeg"),
  ffprobePath = defaultToolPath("ffprobe")
} = {}) {
  const aspects = aspect === "all" ? Object.keys(ASPECT_PRESETS) : [aspect];
  for (const item of aspects) {
    if (!ASPECT_PRESETS[item]) throw new CliError("--aspect must be 16:9, 1:1, 9:16, or all", { exitCode: EXIT.usage });
  }
  const runtime = await verifyRenderTools(ffmpegPath, ffprobePath);
  const aligned = await runAlignment(projectPath, { adapter, model, transcriptId });
  if (!aligned.alignment.quality.structurallyEligible) {
    throw new CliError("publishable rendering requires an eligible forced alignment", { exitCode: EXIT.qualityGate });
  }
  const results = [];
  for (const item of aspects) {
    const scene = buildScene({ transcript: aligned.transcript, alignment: aligned.alignment, aspect: item, title, style });
    results.push(await renderScene({ aligned, scene, ffmpegPath, ffprobePath, runtime }));
  }
  return results;
}

export const __test = Object.freeze({ rational, validateProbe, qcFrameTimes });
