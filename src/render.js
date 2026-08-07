import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAlignment } from "./alignment.js";
import { decodeHevcAlphaSample, measureAlphaPlane, verifyAppleAlphaRuntime } from "./alpha-video.js";
import { compileAss } from "./ass.js";
import { sha256 } from "./canonical-json.js";
import { CliError, EXIT } from "./errors.js";
import { copyNewFile, descendantPath, hashFile, regularFile, writeNewFile, writeNewJson } from "./files.js";
import { runProcess } from "./process.js";
import { ASPECT_PRESETS, buildScene, validateScene } from "./scene.js";
import { defaultToolPath } from "./runtime.js";

export const RENDER_SCHEMA = "transcript-video-render-v2";
export const RENDER_SETTINGS_VERSION = "opaque-videotoolbox-aac-v2";
export const TRANSPARENT_RENDER_SETTINGS_VERSION = "alpha-prores4444-pcm-v1";
export const HEVC_ALPHA_RENDER_SETTINGS_VERSION = "alpha-hevc-videotoolbox-aac-v1";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
const FONT_ASSETS = Object.freeze([
  { source: "resources/fonts/Inter.ttf", sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031" },
  { source: "resources/fonts/IBMPlexMono-Regular.ttf", sha256: "6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46" }
]);

function temporaryOutput(directory, renderId, extension) {
  return path.join(directory, `.${renderId}.tmp-${randomBytes(8).toString("hex")}.${extension}`);
}

function renderBackgrounds(value) {
  if (value === "both") return ["opaque", "transparent"];
  if (["opaque", "transparent"].includes(value)) return [value];
  throw new CliError("--background must be opaque, transparent, or both", { exitCode: EXIT.usage });
}

function renderAlphaCodec(value) {
  if (["hevc", "prores"].includes(value)) return value;
  throw new CliError("--alpha-codec must be hevc or prores", { exitCode: EXIT.usage });
}

function codecFor(background, scene, alphaCodec = "hevc") {
  if (background === "transparent") {
    if (alphaCodec === "hevc") {
      return {
        settingsVersion: HEVC_ALPHA_RENDER_SETTINGS_VERSION,
        background,
        alphaCodec,
        alphaMode: "video-toolbox",
        container: "mov",
        video: "hevc_videotoolbox",
        videoProfile: "main",
        videoCodecTag: "hvc1",
        videoBitrate: scene.aspect === "1:1" ? "4M" : "6M",
        alphaQuality: 0.85,
        pixelFormat: "bgra",
        audio: "aac",
        audioBitrate: "192k",
        frameRate: 24,
        color: "bt709"
      };
    }
    return {
      settingsVersion: TRANSPARENT_RENDER_SETTINGS_VERSION,
      background,
      alphaCodec,
      alphaMode: "straight",
      container: "mov",
      video: "prores_ks",
      videoProfile: "4444",
      pixelFormat: "yuva444p10le",
      audio: "pcm_s24le",
      frameRate: 24,
      color: "bt709"
    };
  }
  return {
    settingsVersion: RENDER_SETTINGS_VERSION,
    background,
    alphaMode: "none",
    container: "mp4",
    video: "h264_videotoolbox",
    videoBitrate: scene.layout.bitrate,
    pixelFormat: "yuv420p",
    audio: "aac",
    audioBitrate: "192k",
    frameRate: 24,
    color: "bt709"
  };
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
  const [ffmpeg, ffprobe, filters, encoders, hevcOptions] = await Promise.all([
    toolVersion(ffmpegPath, "ffmpeg"),
    toolVersion(ffprobePath, "ffprobe"),
    runProcess(ffmpegPath, ["-hide_banner", "-filters"], {
      label: "ffmpeg filter check", timeoutMs: 10_000, maximumOutputBytes: 2 * 1024 * 1024
    }),
    runProcess(ffmpegPath, ["-hide_banner", "-encoders"], {
      label: "ffmpeg encoder check", timeoutMs: 10_000, maximumOutputBytes: 2 * 1024 * 1024
    }),
    runProcess(ffmpegPath, ["-hide_banner", "-h", "encoder=hevc_videotoolbox"], {
      label: "HEVC-alpha option check", timeoutMs: 10_000, maximumOutputBytes: 256 * 1024
    })
  ]);
  if (!/^\s*[TSC\.]{2,4}\s+ass\s/m.test(filters.stdout)
      || !/h264_videotoolbox/.test(encoders.stdout)
      || !/hevc_videotoolbox/.test(encoders.stdout)
      || !/-alpha_quality\s+<double>/.test(hevcOptions.stdout)
      || !/\bprores_ks\b/.test(encoders.stdout)
      || !/^\s*V[\.A-Z]{5}\s+.*\bmjpeg\b/m.test(encoders.stdout)
      || !/^\s*V[\.A-Z]{5}\s+.*\btiff\b/m.test(encoders.stdout)
      || !/^\s*A[\.A-Z]{5}\s+.*\baac\b/m.test(encoders.stdout)
      || !/^\s*A[\.A-Z]{5}\s+.*\bpcm_s24le\b/m.test(encoders.stdout)) {
    throw new CliError("ffmpeg lacks the required libass, opaque, alpha, QC, or audio capability", {
      exitCode: EXIT.renderFailure,
      hint: "Run the packaged build script or set PODCAST_VISUALIZER_FFMPEG and PODCAST_VISUALIZER_FFPROBE."
    });
  }
  await verifyAppleAlphaRuntime();
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
    videoProfile: String(video.profile || "unknown"),
    videoCodecTag: String(video.codec_tag_string || "unknown"),
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

function validateProbe(probe, scene, background = "opaque", alphaCodec = "hevc") {
  const expectedFrames = Math.round(scene.durationMs / 1000 * scene.frameRate);
  const durationDeltaMs = Math.abs(probe.durationMs - scene.durationMs);
  const failures = [];
  if (probe.width !== scene.layout.width || probe.height !== scene.layout.height) failures.push("dimensions");
  if (Math.abs(probe.frameRate - 24) > 0.001) failures.push("frame-rate");
  if (Math.abs(probe.frameCount - expectedFrames) > 1) failures.push("frame-count");
  if (durationDeltaMs > 100) failures.push("duration");
  if (background === "transparent") {
    if (alphaCodec === "hevc") {
      if (probe.videoCodec !== "hevc" || probe.pixelFormat !== "yuv420p"
          || probe.videoCodecTag !== "hvc1" || probe.videoProfile !== "Main") {
        failures.push("video-codec");
      }
      if (probe.audioCodec !== "aac" || probe.sampleRate !== 48000 || probe.channels !== 2) {
        failures.push("audio-codec");
      }
    } else {
      if (probe.videoCodec !== "prores" || probe.pixelFormat !== "yuva444p12le"
          || probe.videoCodecTag !== "ap4h") failures.push("video-codec");
      if (probe.audioCodec !== "pcm_s24le" || probe.sampleRate !== 48000 || probe.channels !== 2) {
        failures.push("audio-codec");
      }
    }
  } else {
    if (probe.videoCodec !== "h264" || probe.pixelFormat !== "yuv420p") failures.push("video-codec");
    if (probe.audioCodec !== "aac" || probe.sampleRate !== 48000 || probe.channels !== 2) failures.push("audio-codec");
  }
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

async function alphaCoverage({ ffmpegPath, inputPath, scene, codec }) {
  const atMs = Math.round(scene.title.endsAtMs / 2);
  if (codec.alphaCodec === "hevc") {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-hevc-alpha-qc-"));
    try {
      const decoded = path.join(directory, "decoded.mov");
      await decodeHevcAlphaSample({ inputPath, outputPath: decoded, atMs });
      return {
        atMs, decoder: "AVFoundation",
        ...await measureAlphaPlane({ ffmpegPath, inputPath: decoded })
      };
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  }
  return {
    atMs, decoder: "FFmpeg",
    ...await measureAlphaPlane({ ffmpegPath, inputPath, atMs })
  };
}

async function captureQcFrames({ ffmpegPath, inputPath, projectRoot, renderId, scene, codec }) {
  const directory = descendantPath(projectRoot, "qc");
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const times = qcFrameTimes(scene);
  const frames = [];
  for (const item of times) {
    const extension = codec.background === "transparent" ? "tiff" : "jpg";
    const relativePath = `qc/${renderId}-${item.label}.${extension}`;
    const outputPath = descendantPath(projectRoot, relativePath);
    if (!await fsp.stat(outputPath).catch(() => null)) {
      const outputOptions = codec.background === "transparent"
        ? ["-vf", "scale=480:-2,format=rgba", "-c:v", "tiff", "-pix_fmt", "rgba", "-f", "image2"]
        : ["-vf", "scale=480:-2", "-c:v", "mjpeg", "-q:v", "2", "-f", "image2"];
      let qcInput = inputPath;
      let seekMs = item.milliseconds;
      let temporaryDirectory;
      try {
        if (codec.alphaCodec === "hevc") {
          temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-hevc-frame-"));
          qcInput = path.join(temporaryDirectory, "decoded.mov");
          await decodeHevcAlphaSample({ inputPath, outputPath: qcInput, atMs: item.milliseconds });
          seekMs = 0;
        }
        await runProcess(ffmpegPath, [
          "-nostdin", "-v", "error", "-n", "-ss", (seekMs / 1000).toFixed(3),
          "-i", qcInput, "-frames:v", "1", ...outputOptions, outputPath
        ], { label: `QC frame ${item.label}`, timeoutMs: 2 * 60 * 1000 });
      } finally {
        if (temporaryDirectory) await fsp.rm(temporaryDirectory, { recursive: true, force: true });
      }
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

async function renderScene({ aligned, scene, background, alphaCodec, ffmpegPath, ffprobePath, runtime }) {
  const projectRoot = aligned.projectRoot;
  const fonts = await stageFonts(projectRoot);
  const artifacts = await writeSceneArtifacts(projectRoot, scene);
  const codec = codecFor(background, scene, alphaCodec);
  const renderId = `render_${sha256({
    sceneManifestSha256: scene.manifestSha256,
    runtime,
    codec,
    fonts
  }).slice(0, 24)}`;
  const rendersDirectory = descendantPath(projectRoot, "renders");
  await fsp.mkdir(rendersDirectory, { recursive: true, mode: 0o700 });
  const extension = background === "transparent" ? "mov" : "mp4";
  const alphaSuffix = background === "transparent" && alphaCodec === "prores" ? "-prores" : "";
  const relativeOutputPath = `renders/${renderId}-${scene.aspect.replace(":", "x")}-${background}${alphaSuffix}.${extension}`;
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

  const temporary = temporaryOutput(rendersDirectory, renderId, extension);
  let workingOutput = outputPath;
  const preexisting = await fsp.stat(outputPath).catch(() => null);
  if (!preexisting) {
    workingOutput = temporary;
    const alpha = background === "transparent";
    const source = alpha
      ? `color=c=black@0.0:s=${scene.layout.width}x${scene.layout.height}:r=24:d=${(scene.durationMs / 1000).toFixed(3)},format=rgba`
      : `color=c=0x040506:s=${scene.layout.width}x${scene.layout.height}:r=24:d=${(scene.durationMs / 1000).toFixed(3)}`;
    const videoFilter = alpha
      ? `[0:v]ass=filename=scenes/${scene.sceneId}.ass:fontsdir=runtime/fonts:alpha=1,format=${codec.alphaCodec === "hevc" ? "bgra" : "yuva444p10le"}[v]`
      : `[0:v]ass=filename=scenes/${scene.sceneId}.ass:fontsdir=runtime/fonts,format=yuv420p[v]`;
    const filter = `${videoFilter};[1:a]adelay=${scene.title.endsAtMs}:all=1[a]`;
    const encodeOptions = codec.alphaCodec === "hevc"
      ? [
        "-c:v", "hevc_videotoolbox", "-alpha_quality", String(codec.alphaQuality),
        "-b:v", codec.videoBitrate, "-tag:v", "hvc1", "-pix_fmt", "bgra",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-f", "mov"
      ]
      : alpha ? [
        "-c:v", "prores_ks", "-profile:v", "4", "-vendor", "apl0", "-alpha_bits", "16",
        "-pix_fmt", "yuva444p10le", "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2", "-f", "mov"
      ]
      : [
        "-c:v", "h264_videotoolbox", "-b:v", codec.videoBitrate, "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-f", "mp4"
      ];
    await runProcess(ffmpegPath, [
      "-nostdin", "-v", "error", "-n",
      "-f", "lavfi", "-i", source,
      "-protocol_whitelist", "file,pipe", "-i", aligned.prepare.review.relativePath,
      "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
      "-map_metadata", "-1", "-r", "24", ...encodeOptions,
      "-t", (scene.durationMs / 1000).toFixed(3), temporary
    ], { cwd: projectRoot, label: `render ${scene.aspect}`, timeoutMs: 4 * 60 * 60 * 1000, maximumOutputBytes: 4 * 1024 * 1024 });
  }
  try {
    const probe = await probeOutput(workingOutput, ffprobePath);
    const quality = validateProbe(probe, scene, background, alphaCodec);
    if (!quality.passed) {
      throw new CliError(`render failed technical QC: ${quality.failures.join(", ")}`, { exitCode: EXIT.renderFailure });
    }
    if (!preexisting) {
      await fsp.chmod(temporary, 0o600);
      await fsp.link(temporary, outputPath);
      workingOutput = outputPath;
    }
    const alpha = background === "transparent"
      ? await alphaCoverage({ ffmpegPath, inputPath: workingOutput, scene, codec })
      : null;
    const frames = await captureQcFrames({
      ffmpegPath, inputPath: workingOutput, projectRoot, renderId, scene, codec
    });
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
      quality: { ...quality, alpha, qcFrames: frames }
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
  background = "opaque",
  alphaCodec = "hevc",
  adapter = "whisperx",
  model,
  transcriptId,
  ffmpegPath = defaultToolPath("ffmpeg"),
  ffprobePath = defaultToolPath("ffprobe")
} = {}) {
  const aspects = aspect === "all" ? Object.keys(ASPECT_PRESETS) : [aspect];
  const backgrounds = renderBackgrounds(background);
  const selectedAlphaCodec = renderAlphaCodec(alphaCodec);
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
    for (const selectedBackground of backgrounds) {
      results.push(await renderScene({
        aligned, scene, background: selectedBackground, alphaCodec: selectedAlphaCodec,
        ffmpegPath, ffprobePath, runtime
      }));
    }
  }
  return results;
}

export const __test = Object.freeze({
  rational, validateProbe, qcFrameTimes, renderBackgrounds, renderAlphaCodec, codecFor
});
