import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./canonical-json.js";
import { decodeHevcAlphaSample, measureAlphaPlane } from "./alpha-video.js";
import { CliError } from "./errors.js";
import { hashFile } from "./files.js";
import { runProcess } from "./process.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
export const BUNDLED_RUNTIME_ROOT = path.join(REPOSITORY_ROOT, "runtime", "macos-arm64");
export const BUNDLED_MODELS_ROOT = path.join(BUNDLED_RUNTIME_ROOT, "models");
export const BUNDLED_ALIGNMENT_ROOT = path.join(BUNDLED_RUNTIME_ROOT, "alignment");

async function runtimeTreeEvidence(directory) {
  const entries = [];
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await walk(absolute);
      else entries.push({ absolute, relative, entry });
    }
  }
  await walk(directory);
  const digest = createHash("sha256");
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  for (const item of entries.sort((left, right) => left.relative.localeCompare(right.relative))) {
    if (item.entry.isSymbolicLink()) {
      const target = await fsp.readlink(item.absolute);
      const relative = path.relative(directory, path.resolve(path.dirname(item.absolute), target));
      if (path.isAbsolute(target) || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new CliError(`alignment runtime contains an unsafe symlink: ${item.relative}`);
      }
      digest.update(`L\0${item.relative}\0${target}\0`);
      symlinks += 1;
    } else if (item.entry.isFile()) {
      const stat = await fsp.lstat(item.absolute);
      digest.update(`F\0${item.relative}\0${stat.size}\0${await hashFile(item.absolute)}\0`);
      bytes += stat.size;
      files += 1;
    } else {
      throw new CliError(`alignment runtime contains an unsupported entry: ${item.relative}`);
    }
  }
  return { files, symlinks, bytes, sha256: digest.digest("hex") };
}

export function defaultToolPath(tool) {
  const environmentName = `PODCAST_VISUALIZER_${tool.toUpperCase()}`;
  if (process.env[environmentName]) return process.env[environmentName];
  if (process.platform === "darwin" && process.arch === "arm64") {
    const name = tool === "speech" ? "podcast-visualizer-speech" : tool;
    const bundled = path.join(BUNDLED_RUNTIME_ROOT, "bin", name);
    try {
      fs.accessSync(bundled, fs.constants.X_OK);
      return bundled;
    } catch {
      return `/opt/homebrew/bin/${tool}`;
    }
  }
  return tool;
}

export async function validateBundledSpeechRuntime() {
  const manifestPath = path.join(BUNDLED_RUNTIME_ROOT, "speech-manifest.json");
  let manifest;
  try {
    const stat = await fsp.lstat(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) throw new Error();
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    throw new CliError("bundled speech runtime manifest is missing or invalid");
  }
  const keys = new Set([
    "schemaVersion", "platform", "minimumMacOS", "recordRevision", "fluidAudio",
    "swiftVersion", "file", "manifestSha256"
  ]);
  if (!manifest || Object.keys(manifest).some((key) => !keys.has(key))
      || manifest.schemaVersion !== "podcast-visualizer-speech-runtime-v1"
      || manifest.platform !== "macos-arm64" || !/^\d+\.\d+$/.test(manifest.minimumMacOS)
      || !/^[a-f0-9]{40}$/.test(manifest.recordRevision)
      || manifest.fluidAudio?.version !== "0.15.5"
      || !/^[a-f0-9]{40}$/.test(manifest.fluidAudio?.revision)
      || manifest.file?.path !== "bin/podcast-visualizer-speech"
      || !Number.isSafeInteger(manifest.file?.bytes) || manifest.file.bytes < 1
      || !/^[a-f0-9]{64}$/.test(manifest.file?.sha256)
      || !Array.isArray(manifest.file?.dependencies)) {
    throw new CliError("bundled speech runtime manifest contract is invalid");
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) {
    throw new CliError("bundled speech runtime manifest hash does not match");
  }
  const binary = path.join(BUNDLED_RUNTIME_ROOT, manifest.file.path);
  const stat = await fsp.lstat(binary).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== manifest.file.bytes
      || (stat.mode & 0o111) === 0 || await hashFile(binary) !== manifest.file.sha256) {
    throw new CliError("bundled speech runtime failed verification");
  }
  if (manifest.file.dependencies.some((dependency) => !dependency.startsWith("/usr/lib/")
      && !dependency.startsWith("/System/Library/"))) {
    throw new CliError("bundled speech runtime retained a non-system dependency");
  }
  return manifest;
}

export async function validateBundledNodeRuntime() {
  const manifestPath = path.join(BUNDLED_RUNTIME_ROOT, "node-manifest.json");
  let manifest;
  try {
    const stat = await fsp.lstat(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) throw new Error();
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    throw new CliError("bundled Node runtime manifest is missing or invalid");
  }
  const keys = new Set([
    "schemaVersion", "platform", "version", "minimumMacOS", "license", "source", "files", "manifestSha256"
  ]);
  if (!manifest || Object.keys(manifest).some((key) => !keys.has(key))
      || manifest.schemaVersion !== "podcast-visualizer-node-runtime-v1"
      || manifest.platform !== "macos-arm64" || !/^24\.\d+\.\d+$/.test(manifest.version)
      || !/^\d+\.\d+$/.test(manifest.minimumMacOS)
      || manifest.license !== "Node.js contributors license"
      || !manifest.source?.url?.startsWith("https://nodejs.org/dist/")
      || !/^[a-f0-9]{64}$/.test(manifest.source?.sha256)
      || !Array.isArray(manifest.files) || manifest.files.length !== 2) {
    throw new CliError("bundled Node runtime manifest contract is invalid");
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) {
    throw new CliError("bundled Node runtime manifest hash does not match");
  }
  const expectedPaths = new Set(["bin/node", "LICENSE.Node"]);
  for (const file of manifest.files) {
    if (!expectedPaths.delete(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1
        || !/^[a-f0-9]{64}$/.test(file.sha256) || !Array.isArray(file.dependencies)) {
      throw new CliError("bundled Node runtime file evidence is invalid");
    }
    const target = path.join(BUNDLED_RUNTIME_ROOT, file.path);
    const stat = await fsp.lstat(target).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.bytes
        || await hashFile(target) !== file.sha256
        || file.dependencies.some((dependency) => !dependency.startsWith("/usr/lib/")
          && !dependency.startsWith("/System/Library/"))) {
      throw new CliError(`bundled Node runtime failed verification: ${file.path}`);
    }
    if (file.path === "bin/node" && (stat.mode & 0o111) === 0) {
      throw new CliError("bundled Node runtime is not executable");
    }
  }
  if (expectedPaths.size) throw new CliError("bundled Node runtime is incomplete");
  return manifest;
}

export async function validateBundledAlignmentRuntime() {
  const manifestPath = path.join(BUNDLED_RUNTIME_ROOT, "alignment-manifest.json");
  let manifest;
  try {
    const stat = await fsp.lstat(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error();
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    throw new CliError("bundled alignment runtime manifest is missing or invalid");
  }
  const keys = new Set([
    "schemaVersion", "platform", "minimumMacOS", "pythonVersion", "pythonProvider",
    "whisperxVersion", "runnerRevision", "sourceManifestSha256", "punktTab", "tree",
    "pythonLicense", "machoFilesInspected", "packages", "manifestSha256"
  ]);
  if (!manifest || Object.keys(manifest).some((key) => !keys.has(key))
      || manifest.schemaVersion !== "podcast-visualizer-alignment-runtime-v1"
      || manifest.platform !== "macos-arm64" || manifest.pythonVersion !== "3.13.13"
      || manifest.whisperxVersion !== "3.8.6" || !/^[a-f0-9]{40}$/.test(manifest.runnerRevision)
      || !/^[a-f0-9]{64}$/.test(manifest.sourceManifestSha256)
      || !/^[a-f0-9]{64}$/.test(manifest.pythonLicense?.sha256)
      || !/^[a-f0-9]{64}$/.test(manifest.punktTab?.sha256)
      || !Number.isSafeInteger(manifest.tree?.files) || manifest.tree.files < 100
      || !Number.isSafeInteger(manifest.tree?.bytes) || manifest.tree.bytes < 100_000_000
      || !/^[a-f0-9]{64}$/.test(manifest.tree?.sha256)
      || !Number.isSafeInteger(manifest.machoFilesInspected) || manifest.machoFilesInspected < 10
      || !Array.isArray(manifest.packages) || manifest.packages.length < 20
      || !manifest.packages.some((item) => item.name?.toLowerCase() === "whisperx" && item.version === "3.8.6")) {
    throw new CliError("bundled alignment runtime manifest contract is invalid");
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) {
    throw new CliError("bundled alignment runtime manifest hash does not match");
  }
  const stat = await fsp.lstat(BUNDLED_ALIGNMENT_ROOT).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError("bundled alignment runtime is missing");
  }
  const evidence = await runtimeTreeEvidence(BUNDLED_ALIGNMENT_ROOT);
  if (JSON.stringify(evidence) !== JSON.stringify(manifest.tree)) {
    throw new CliError("bundled alignment runtime failed verification");
  }
  const python = path.join(BUNDLED_ALIGNMENT_ROOT, "python", "bin", "python3.13");
  const pythonStat = await fsp.lstat(python).catch(() => null);
  if (!pythonStat || pythonStat.isSymbolicLink() || !pythonStat.isFile() || (pythonStat.mode & 0o111) === 0) {
    throw new CliError("bundled alignment Python is missing or not executable");
  }
  return {
    ...manifest,
    python,
    sitePackages: path.join(BUNDLED_ALIGNMENT_ROOT, "site-packages"),
    nltkData: path.join(BUNDLED_ALIGNMENT_ROOT, "nltk_data")
  };
}

function safeRuntimePath(relativePath) {
  if (!/^(?:bin\/(?:ffmpeg|ffprobe)|lib\/[A-Za-z0-9._+-]+\.dylib)$/.test(relativePath)) {
    throw new CliError(`runtime manifest path is invalid: ${relativePath}`);
  }
  const absolute = path.resolve(BUNDLED_RUNTIME_ROOT, relativePath);
  if (path.relative(BUNDLED_RUNTIME_ROOT, absolute).startsWith("..")) throw new CliError("runtime path escapes its root");
  return absolute;
}

export async function validateBundledRuntime() {
  const manifestPath = path.join(BUNDLED_RUNTIME_ROOT, "manifest.json");
  let manifest;
  try {
    const stat = await fsp.lstat(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error();
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    throw new CliError("bundled FFmpeg runtime manifest is missing or invalid");
  }
  const keys = new Set(["schemaVersion", "platform", "license", "source", "configureFlags", "files", "manifestSha256"]);
  if (!manifest || Object.keys(manifest).some((key) => !keys.has(key))
      || manifest.schemaVersion !== "podcast-visualizer-ffmpeg-runtime-v1"
      || manifest.platform !== "macos-arm64" || manifest.license !== "LGPL-2.1-or-later"
      || !Array.isArray(manifest.files) || manifest.files.length < 3
      || !manifest.configureFlags?.includes("--disable-network")
      || !manifest.configureFlags?.includes("--enable-libass")
      || manifest.configureFlags.some((flag) => ["--enable-gpl", "--enable-nonfree"].includes(flag))) {
    throw new CliError("bundled FFmpeg runtime manifest contract is invalid");
  }
  const { manifestSha256, ...body } = manifest;
  if (manifestSha256 !== sha256(`${JSON.stringify(body)}\n`)) throw new CliError("bundled FFmpeg runtime manifest hash does not match");
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !Array.isArray(file.dependencies)) {
      throw new CliError("bundled FFmpeg runtime file evidence is invalid");
    }
    seen.add(file.path);
    const absolute = safeRuntimePath(file.path);
    const stat = await fsp.lstat(absolute).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.bytes
        || await hashFile(absolute) !== file.sha256 || (stat.mode & 0o111) === 0) {
      throw new CliError(`bundled runtime file failed verification: ${file.path}`);
    }
    if (file.dependencies.some((dependency) => dependency.startsWith("/opt/homebrew/") || dependency.startsWith("/usr/local/"))) {
      throw new CliError(`bundled runtime retained a developer-machine dependency: ${file.path}`);
    }
  }
  if (!seen.has("bin/ffmpeg") || !seen.has("bin/ffprobe")) throw new CliError("bundled runtime tools are incomplete");
  return manifest;
}

export async function smokeTestBundledRuntime() {
  const manifest = await validateBundledRuntime();
  const ffmpeg = defaultToolPath("ffmpeg");
  const ffprobe = defaultToolPath("ffprobe");
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-doctor-"));
  try {
    const fonts = path.join(directory, "fonts");
    await fsp.mkdir(fonts, { mode: 0o700 });
    await Promise.all([
      fsp.copyFile(path.join(REPOSITORY_ROOT, "resources/fonts/Inter.ttf"), path.join(fonts, "Inter.ttf")),
      fsp.copyFile(path.join(REPOSITORY_ROOT, "resources/fonts/IBMPlexMono-Regular.ttf"), path.join(fonts, "IBMPlexMono-Regular.ttf"))
    ]);
    const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Inter,24,&H00FFFFFF,&H00444444,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,runtime smoke\n`;
    await fsp.writeFile(path.join(directory, "smoke.ass"), ass, { flag: "wx", mode: 0o600 });
    const output = path.join(directory, "smoke.mp4");
    await runProcess(ffmpeg, [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=0.5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.5",
      "-filter_complex", "[0:v]ass=filename=smoke.ass:fontsdir=fonts,format=yuv420p[v]",
      "-map", "[v]", "-map", "1:a", "-c:v", "h264_videotoolbox", "-b:v", "1M",
      "-c:a", "aac", "-b:a", "96k", "-f", "mp4", output
    ], { cwd: directory, label: "bundled runtime encode smoke test", timeoutMs: 2 * 60 * 1000 });
    const probe = await runProcess(ffprobe, ["-v", "error", "-show_streams", "-of", "json", output], {
      label: "bundled runtime decode smoke test", timeoutMs: 60_000
    });
    const streams = JSON.parse(probe.stdout).streams;
    if (!streams?.some(({ codec_type: type, codec_name: codec }) => type === "video" && codec === "h264")
        || !streams?.some(({ codec_type: type, codec_name: codec }) => type === "audio" && codec === "aac")) {
      throw new CliError("bundled runtime smoke output is invalid");
    }
    const qcFrame = path.join(directory, "smoke.jpg");
    await runProcess(ffmpeg, [
      "-nostdin", "-v", "error", "-i", output, "-frames:v", "1", "-c:v", "mjpeg",
      "-q:v", "2", "-f", "image2", qcFrame
    ], { label: "bundled runtime QC-frame smoke test", timeoutMs: 60_000 });
    const jpeg = await fsp.readFile(qcFrame);
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      throw new CliError("bundled runtime QC-frame output is invalid");
    }
    const alphaOutput = path.join(directory, "smoke-alpha.mov");
    await runProcess(ffmpeg, [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i",
      "color=c=black@0.0:s=320x180:r=24:d=0.5,format=rgba",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.5",
      "-filter_complex", "[0:v]ass=filename=smoke.ass:fontsdir=fonts:alpha=1,format=yuva444p10le[v]",
      "-map", "[v]", "-map", "1:a", "-c:v", "prores_ks", "-profile:v", "4",
      "-vendor", "apl0", "-alpha_bits", "16", "-pix_fmt", "yuva444p10le",
      "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2", "-f", "mov", alphaOutput
    ], { cwd: directory, label: "bundled runtime alpha encode smoke test", timeoutMs: 2 * 60 * 1000 });
    const alphaProbe = await runProcess(ffprobe, ["-v", "error", "-show_streams", "-of", "json", alphaOutput], {
      label: "bundled runtime alpha decode smoke test", timeoutMs: 60_000
    });
    const alphaStreams = JSON.parse(alphaProbe.stdout).streams;
    if (!alphaStreams?.some(({ codec_type: type, codec_name: codec, pix_fmt: pixelFormat }) =>
      type === "video" && codec === "prores" && pixelFormat === "yuva444p12le")
        || !alphaStreams?.some(({ codec_type: type, codec_name: codec }) =>
          type === "audio" && codec === "pcm_s24le")) {
      throw new CliError("bundled runtime alpha smoke output is invalid");
    }
    await measureAlphaPlane({ ffmpegPath: ffmpeg, inputPath: alphaOutput, atMs: 250 });
    const hevcAlphaOutput = path.join(directory, "smoke-alpha-hevc.mov");
    await runProcess(ffmpeg, [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i",
      "color=c=black@0.0:s=320x180:r=24:d=0.5,format=rgba",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.5",
      "-filter_complex", "[0:v]ass=filename=smoke.ass:fontsdir=fonts:alpha=1,format=bgra[v]",
      "-map", "[v]", "-map", "1:a", "-c:v", "hevc_videotoolbox",
      "-alpha_quality", "0.85", "-b:v", "1M", "-tag:v", "hvc1", "-pix_fmt", "bgra",
      "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "2", "-f", "mov", hevcAlphaOutput
    ], { cwd: directory, label: "bundled runtime compact alpha encode smoke test", timeoutMs: 2 * 60 * 1000 });
    const hevcProbe = await runProcess(ffprobe, ["-v", "error", "-show_streams", "-of", "json", hevcAlphaOutput], {
      label: "bundled runtime compact alpha stream smoke test", timeoutMs: 60_000
    });
    const hevcStreams = JSON.parse(hevcProbe.stdout).streams;
    if (!hevcStreams?.some(({ codec_type: type, codec_name: codec, codec_tag_string: tag }) =>
      type === "video" && codec === "hevc" && tag === "hvc1")
        || !hevcStreams?.some(({ codec_type: type, codec_name: codec }) =>
          type === "audio" && codec === "aac")) {
      throw new CliError("bundled runtime compact alpha streams are invalid");
    }
    const decodedHevcAlpha = path.join(directory, "smoke-alpha-hevc-decoded.mov");
    await decodeHevcAlphaSample({
      inputPath: hevcAlphaOutput, outputPath: decodedHevcAlpha, atMs: 100, durationMs: 250
    });
    await measureAlphaPlane({ ffmpegPath: ffmpeg, inputPath: decodedHevcAlpha });
    const protocols = await runProcess(ffmpeg, ["-hide_banner", "-protocols"], { label: "bundled runtime protocol check" });
    if (/^\s*(?:http|https|tcp|udp|rtmp|srt)\s*$/m.test(protocols.stdout)) {
      throw new CliError("bundled runtime unexpectedly enables network protocols");
    }
    return {
      manifestSha256: manifest.manifestSha256, ffmpeg, ffprobe,
      hevcAlpha: true, proresAlpha: true
    };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}
