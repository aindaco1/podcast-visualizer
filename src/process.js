import { spawn } from "node:child_process";

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
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumOutputBytes = DEFAULT_MAXIMUM_OUTPUT_BYTES,
  label = command,
  onStdout,
  onStderr,
  onAuxiliary,
  captureStdout = true,
  captureStderr = true,
  captureAuxiliary = false
} = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("process arguments must be an array of strings");
  }
  return await new Promise((resolve, reject) => {
    const usesAuxiliaryPipe = typeof onAuxiliary === "function" || captureAuxiliary;
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", ...(usesAuxiliaryPipe ? ["pipe"] : [])]
    });
    const stdout = [];
    const stderr = [];
    const auxiliary = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const collect = (destination, callback, capture) => (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        child.kill("SIGKILL");
        fail(processFailure(`${label} emitted too much output`, { cause: "process_output_limit" }));
        return;
      }
      try {
        callback?.(chunk);
      } catch (error) {
        child.kill("SIGKILL");
        fail(error);
        return;
      }
      if (capture) destination.push(chunk);
    };
    child.stdout.on("data", collect(stdout, onStdout, captureStdout));
    child.stderr.on("data", collect(stderr, onStderr, captureStderr));
    if (usesAuxiliaryPipe) {
      child.stdio[3].on("data", collect(auxiliary, onAuxiliary, captureAuxiliary));
    }
    child.on("error", (error) => fail(processFailure(`${label} could not start`,
      { cause: "process_spawn", systemCode: error.code }, error.message)));
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        auxiliary: Buffer.concat(auxiliary).toString("utf8")
      };
      if (timedOut) {
        reject(processFailure(`${label} exceeded its time limit`, { cause: "process_timeout", processSignal: signal }));
      } else if (code !== 0) {
        const detail = result.stderr.trim().split("\n").slice(-8).join("\n");
        reject(processFailure(`${label} failed${detail ? `: ${detail}` : ""}`,
          { cause: signal ? "process_signal" : "process_exit", reason: processReason(result.stderr),
            processExitCode: code, processSignal: signal }));
      } else {
        resolve(result);
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
  });
}
