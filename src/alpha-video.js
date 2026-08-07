import fsp from "node:fs/promises";

import { CliError, EXIT } from "./errors.js";
import { runProcess } from "./process.js";

export const AVCONVERT_PATH = "/usr/bin/avconvert";

export async function verifyAppleAlphaRuntime() {
  const stat = await fsp.lstat(AVCONVERT_PATH).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) {
    throw new CliError("macOS AVFoundation alpha decoder is unavailable", {
      exitCode: EXIT.renderFailure
    });
  }
  return AVCONVERT_PATH;
}

export async function decodeHevcAlphaSample({ inputPath, outputPath, atMs, durationMs = 250 }) {
  await verifyAppleAlphaRuntime();
  await runProcess(AVCONVERT_PATH, [
    "--source", inputPath,
    "--preset", "PresetAppleProRes4444LPCM",
    "--output", outputPath,
    "--start", (atMs / 1000).toFixed(3),
    "--duration", (durationMs / 1000).toFixed(3),
    "--replace"
  ], {
    label: "AVFoundation HEVC-alpha decode QC",
    timeoutMs: 2 * 60 * 1000,
    maximumOutputBytes: 256 * 1024
  });
  const stat = await fsp.lstat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1) {
    throw new CliError("AVFoundation HEVC-alpha decode produced no media", {
      exitCode: EXIT.renderFailure
    });
  }
  return outputPath;
}

export async function measureAlphaPlane({ ffmpegPath, inputPath, atMs = 0, bits = 12 }) {
  const result = await runProcess(ffmpegPath, [
    "-nostdin", "-v", "error", "-ss", (atMs / 1000).toFixed(3), "-i", inputPath,
    "-frames:v", "1", "-vf", "alphaextract,signalstats,metadata=print:file=-", "-f", "null", "-"
  ], { label: "decoded alpha-plane QC", timeoutMs: 2 * 60 * 1000, maximumOutputBytes: 256 * 1024 });
  const evidence = `${result.stdout}\n${result.stderr}`;
  const minimum = Number(/lavfi\.signalstats\.YMIN=([0-9.]+)/.exec(evidence)?.[1]);
  const maximum = Number(/lavfi\.signalstats\.YMAX=([0-9.]+)/.exec(evidence)?.[1]);
  const average = Number(/lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(evidence)?.[1]);
  const scale = (2 ** bits) - 1;
  const normalizedMinimum = minimum / scale;
  const normalizedMaximum = maximum / scale;
  const normalizedAverage = average / scale;
  if (![minimum, maximum, average, normalizedMinimum, normalizedMaximum, normalizedAverage].every(Number.isFinite)
      || normalizedMinimum > 0.08 || normalizedMaximum < 0.2) {
    throw new CliError("transparent render alpha plane is empty or opaque", {
      exitCode: EXIT.renderFailure
    });
  }
  return {
    bits, minimum, maximum, average,
    normalizedMinimum, normalizedMaximum, normalizedAverage
  };
}
