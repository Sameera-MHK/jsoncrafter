// Errors that the CLI knows how to report without a stack trace.
export class JsonForgeError extends Error {
  constructor(message, { code = 'ERROR', hint, exitCode = 1 } = {}) {
    super(message);
    this.name = 'JsonForgeError';
    this.code = code;
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

// Wrong flags, missing arguments, invalid option values.
export class UsageError extends JsonForgeError {
  constructor(message, { code = 'USAGE', hint } = {}) {
    super(message, { code, hint, exitCode: 2 });
    this.name = 'UsageError';
  }
}
