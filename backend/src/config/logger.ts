import pino from 'pino';
import { env } from './env.js';

/**
 * Structured JSON logging with request IDs — Backend Spec §1 (pino).
 * Redaction: never log passwords/tokens/secrets.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  base: { env: env.NODE_ENV },
});
