/**
 * Barrel for typed domain errors — Backend Spec §1 (`errors/index.ts`).
 * Import from here: `import { AppError, ValidationError } from './index.js'`.
 */
export { AppError, ValidationError } from './app-error.js';
export { ERROR_CODES, type ErrorCode } from '../config/constants.js';
