export const EXIT = Object.freeze({
  ok: 0,
  failure: 1,
  usage: 2,
  reviewRequired: 3,
  modelMissing: 4,
  qualityGate: 5,
  renderFailure: 6
});

const CAUSES = new Set(["type_error", "range_error", "syntax_error", "reference_error", "unknown",
  "process_exit", "process_signal", "process_timeout", "process_output_limit", "process_spawn"]);
const SYSTEM_CODES = new Set(["ENOSPC", "EACCES", "EPERM", "ENOENT", "EIO", "EMFILE", "ENFILE", "ENOMEM", "EROFS", "EEXIST"]);
const SIGNALS = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGTRAP", "SIGPIPE", "SIGINT"]);
const REASONS = new Set(["disk_full", "permission_denied", "encoder_unavailable", "encoder_initialization", "invalid_media"]);

// Serialize categories, never error messages, stacks, paths, or helper streams.
export function failureDetails(error) {
  const source = error?.failureDetails ?? {};
  const kind = error instanceof TypeError ? "type_error" : error instanceof RangeError ? "range_error"
    : error instanceof SyntaxError ? "syntax_error" : error instanceof ReferenceError ? "reference_error" : "unknown";
  return {
    cause: CAUSES.has(source.cause) ? source.cause : kind,
    ...(REASONS.has(source.reason) ? { reason: source.reason } : {}),
    ...(SYSTEM_CODES.has(source.systemCode ?? error?.code) ? { systemCode: source.systemCode ?? error.code } : {}),
    ...(Number.isInteger(source.processExitCode) && source.processExitCode >= 0 && source.processExitCode <= 255
      ? { processExitCode: source.processExitCode } : {}),
    ...(SIGNALS.has(source.processSignal) ? { processSignal: source.processSignal } : {})
  };
}

export class CliError extends Error {
  constructor(message, { exitCode = EXIT.failure, hint = null, diagnosticCode = null } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
    if (diagnosticCode !== null && !/^[a-z][a-z0-9_]{0,63}$/.test(diagnosticCode)) {
      throw new TypeError("diagnostic code is invalid");
    }
    this.diagnosticCode = diagnosticCode;
  }
}
