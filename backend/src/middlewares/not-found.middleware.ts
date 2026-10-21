import type { Request, Response } from 'express';

/** 404 handling — standard error envelope (Backend Spec §2). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      traceId: (req.id as string) ?? 'unknown',
    },
  });
}
