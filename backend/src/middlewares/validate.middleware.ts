import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Schema validation on every write — Backend Spec §5.
 * Strips unknown keys, returns 422 with field-level details (one per failing field).
 */
export function validate<T extends z.ZodTypeAny>(schema: T, source: 'body' | 'query' | 'params' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        issue: issue.message,
      }));
      next(new ValidationError(fieldErrors));
      return;
    }
    if (source === 'body') {
      req.body = result.data;
    }
    next();
  };
}

export { z };
