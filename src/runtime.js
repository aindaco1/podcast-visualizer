import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { hashFile } from "./files.js";
import { runProcess } from "./process.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(MODULE_ROOT, "..");
export const BUNDLED_RUNTIME_ROOT = path.join(REPOSITORY_ROOT, "runtime", "macos-arm64");

export function defaultToolPath(tool) {
  const environmentName = `PODCAST_VISUALIZER_${tool.toUpperCase()}`;
  if (process.env[environmentName]) return process.env[environmentName];
  if (process.platform === "darwin" && process.arch === "arm64") {
    const bundled = path.join(BUNDLED_RUNTIME_ROOT, "bin", tool);
    try {
      fs.accessSync(bundled, fs.constants.X_OK);
      return bundled;
    } catch {
      return `/opt/homebrew/bin/${tool}`;
    }
  }
  return tool;
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
    const protocols = await runProcess(ffmpeg, ["-hide_banner", "-protocols"], { label: "bundled runtime protocol check" });
    if (/^\s*(?:http|https|tcp|udp|rtmp|srt)\s*$/m.test(protocols.stdout)) {
      throw new CliError("bundled runtime unexpectedly enables network protocols");
    }
    return { manifestSha256: manifest.manifestSha256, ffmpeg, ffprobe };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}
