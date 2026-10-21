import { ERROR_CODES, type ErrorCode } from '../config/constants.js';

/**
 * Typed domain errors mapped by the central error handler — Backend Spec §7.
 * HTTP status comes from the ERROR_CODES catalog (06-API-AND-ERRORS/02 §3).
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(details: Array<{ field: string; issue: string; suggestions?: string[] }>) {
    super('VALIDATION_ERROR', 'The submitted data has validation errors.', details);
    this.name = 'ValidationError';
  }
}
