import { spawn } from "node:child_process";

import { CliError } from "./errors.js";

const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

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
        fail(new CliError(`${label} emitted too much output`));
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
    child.on("error", (error) => fail(new CliError(`${label} could not start`, { hint: error.message })));
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
        reject(new CliError(`${label} exceeded its time limit`));
      } else if (code !== 0) {
        const detail = result.stderr.trim().split("\n").slice(-8).join("\n");
        reject(new CliError(`${label} failed${detail ? `: ${detail}` : ""}`));
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
