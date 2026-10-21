import { runCapturedProcess } from "@dustwave/node-core/process";

import { CliError, failureDetails } from "./errors.js";

const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function processFailure(message, details, hint = null) {
  const error = new CliError(message, { hint });
  error.failureDetails = failureDetails({ failureDetails: details });
  return error;
}

function processReason(stderr) {
  if (/no space left on device/i.test(stderr)) return "disk_full";
  if (/permission denied|operation not permitted/i.test(stderr)) return "permission_denied";
  if (/unknown encoder|encoder .* not found/i.test(stderr)) return "encoder_unavailable";
  if (/error (?:while )?opening encoder|cannot create compression session|failed to create.*encoder/i.test(stderr)) return "encoder_initialization";
  if (/invalid data found when processing input|error while decoding/i.test(stderr)) return "invalid_media";
  return undefined;
}

export async function runProcess(command, args, {
  cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, maximumOutputBytes = DEFAULT_MAXIMUM_OUTPUT_BYTES,
  label = command, onStdout, onStderr, onAuxiliary,
  captureStdout = true, captureStderr = true, captureAuxiliary = false
} = {}) {
  const usesAuxiliaryPipe = typeof onAuxiliary === "function" || captureAuxiliary;
  const result = await runCapturedProcess(command, args, {
    cwd, env: env ? { ...process.env, ...env } : process.env,
    processGroup: true, timeoutMs, maximumOutputBytes,
    streams: [
      { name: "stdout", onData: onStdout, capture: captureStdout },
      { name: "stderr", onData: onStderr, capture: captureStderr },
      ...(usesAuxiliaryPipe ? [{ name: "auxiliary", onData: onAuxiliary, capture: captureAuxiliary }] : [])
    ],
    errors: {
      spawn: ({ error }) => processFailure(`${label} could not start`, { cause: "process_spawn", systemCode: error.code }, error.message),
      limit: () => processFailure(`${label} emitted too much output`, { cause: "process_output_limit" }),
      timeout: result => processFailure(`${label} exceeded its time limit`, { cause: "process_timeout", processSignal: result.signal }),
      exit: result => {
        const detail = result.stderr.trim().split("\n").slice(-8).join("\n");
        return processFailure(`${label} failed${detail ? `: ${detail}` : ""}`,
          { cause: result.signal ? "process_signal" : "process_exit", reason: processReason(result.stderr),
            processExitCode: result.code, processSignal: result.signal });
      }
    }
  });
  return { ...result, auxiliary: result.auxiliary ?? "" };
}
