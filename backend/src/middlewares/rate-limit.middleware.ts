import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Rate limiting — NFR-10 / API Standards §1.
 * Global default; stricter on /auth (brute-force protection).
 */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please wait before trying again.',
    },
  },
});
