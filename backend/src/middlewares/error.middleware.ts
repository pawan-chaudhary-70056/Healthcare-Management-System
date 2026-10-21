import type { NextFunction, Request, Response } from 'express';
import { AppError, ValidationError } from '../errors/app-error.js';
import { logger } from '../config/logger.js';

export { attachRequestId } from './request-id.middleware.js';
export { notFoundHandler } from './not-found.middleware.js';

/**
 * Standard error envelope — 06-API-AND-ERRORS/02 §1.
 * { error: { code, message, details?, traceId } }
 * Logs full context server-side; returns minimal safe info (§6).
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const traceId = (req.id ?? 'unknown') as string;

  if (err instanceof ValidationError) {
    logger.warn({ traceId, code: err.code, details: err.details }, 'Validation failed');
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        traceId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn({ traceId, code: err.code, status: err.status }, err.message);
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, traceId },
    });
    return;
  }

  // Unexpected — log fully (minus secrets via pino redact), return minimally.
  logger.error({ traceId, err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again or contact support with this reference.',
      traceId,
    },
  });
}
