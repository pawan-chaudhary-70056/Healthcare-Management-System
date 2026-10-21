import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wrap async handlers so rejections reach the central error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
