import { spawn } from "node:child_process";

import { CliError } from "./errors.js";

const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export async function runProcess(command, args, {
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumOutputBytes = DEFAULT_MAXIMUM_OUTPUT_BYTES,
  label = command
} = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("process arguments must be an array of strings");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const collect = (destination) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        child.kill("SIGKILL");
        fail(new CliError(`${label} emitted too much diagnostic output`));
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => fail(new CliError(`${label} could not start`, { hint: error.message })));
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
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
