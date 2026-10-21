import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * request-id middleware — Backend Spec §1 (`core/middleware/`).
 * Re-attached to the mandatory chain order in §2 (parsed before rate limiting).
 * Honors an inbound `x-request-id` (trusted deployments) or mints a UUID; the
 * value doubles as the error-envelope `traceId`.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  req.id = (typeof header === 'string' && header.length > 0 ? header : randomUUID()) as string;
  res.setHeader('X-Request-Id', req.id);
  next();
}
