import fs from "node:fs";

import { CliError, EXIT } from "./errors.js";

export const PROGRESS_SCHEMA = "podcast-visualizer-progress-v1";
export const MAXIMUM_PROGRESS_EVENT_BYTES = 8 * 1024;

const EVENT_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

function parseDescriptor(value) {
  if (!/^[0-9]{1,2}$/.test(String(value ?? ""))) {
    throw new CliError("--progress-fd must be an integer from 3 through 63", {
      exitCode: EXIT.usage
    });
  }
  const descriptor = Number(value);
  if (descriptor < 3 || descriptor > 63) {
    throw new CliError("--progress-fd must be an integer from 3 through 63", {
      exitCode: EXIT.usage
    });
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (stat.isDirectory()) throw new Error("descriptor is a directory");
  } catch {
    throw new CliError("--progress-fd is not an open writable descriptor", {
      exitCode: EXIT.usage
    });
  }
  return descriptor;
}

export function extractProgressDescriptor(argv) {
  const filtered = [];
  let descriptor = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--progress-fd" && !token.startsWith("--progress-fd=")) {
      filtered.push(token);
      continue;
    }
    if (descriptor !== null) {
      throw new CliError("option repeated: --progress-fd", { exitCode: EXIT.usage });
    }
    const inline = token.startsWith("--progress-fd=") ? token.slice("--progress-fd=".length) : null;
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new CliError("--progress-fd requires a value", { exitCode: EXIT.usage });
    }
    descriptor = parseDescriptor(value);
  }
  return { argv: filtered, descriptor };
}

export function createProgressReporter({ descriptor, command }) {
  let sequence = 0;
  return Object.freeze({
    enabled: descriptor !== null,
    emit(event, detail = {}) {
      if (descriptor === null) return;
      if (!EVENT_NAME.test(event)) throw new TypeError("progress event name is invalid");
      if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
        throw new TypeError("progress event detail must be an object");
      }
      const payload = {
        schemaVersion: PROGRESS_SCHEMA,
        sequence: ++sequence,
        command,
        event,
        detail
      };
      const line = `${JSON.stringify(payload)}\n`;
      if (Buffer.byteLength(line) > MAXIMUM_PROGRESS_EVENT_BYTES) {
        throw new CliError("progress event exceeded its size limit");
      }
      try {
        fs.writeSync(descriptor, line, null, "utf8");
      } catch {
        throw new CliError("progress stream could not be written");
      }
    }
  });
}
