import { CliError, EXIT } from "./errors.js";

const CLOCK = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]?\d(?:\.\d{1,3})?)$/;

export function parseClock(value, label = "time") {
  const match = CLOCK.exec(String(value ?? "").trim());
  if (!match) {
    throw new CliError(`${label} must use HH:MM:SS, MM:SS, or MM:SS.mmm`, {
      exitCode: EXIT.usage
    });
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new CliError(`${label} is outside the supported range`, { exitCode: EXIT.usage });
  }
  return milliseconds;
}

export function parseClip(value) {
  const parts = String(value ?? "").split("-");
  if (parts.length !== 2) {
    throw new CliError("--clip must use START-END", { exitCode: EXIT.usage });
  }
  const startsAtMs = parseClock(parts[0], "clip start");
  const endsAtMs = parseClock(parts[1], "clip end");
  if (endsAtMs <= startsAtMs) {
    throw new CliError("clip end must be after clip start", { exitCode: EXIT.usage });
  }
  if (endsAtMs - startsAtMs > 24 * 60 * 60 * 1000) {
    throw new CliError("clip duration exceeds 24 hours", { exitCode: EXIT.usage });
  }
  return { startsAtMs, endsAtMs, durationMs: endsAtMs - startsAtMs };
}

