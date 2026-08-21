export const EXIT = Object.freeze({
  ok: 0,
  failure: 1,
  usage: 2,
  reviewRequired: 3,
  modelMissing: 4,
  qualityGate: 5,
  renderFailure: 6
});

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
