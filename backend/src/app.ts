import express from 'express';
import { applySecurity } from './config/security.js';
import { globalLimiter } from './middlewares/rate-limit.middleware.js';
import { attachRequestId, errorHandler } from './middlewares/error.middleware.js';
import { notFoundHandler } from './middlewares/not-found.middleware.js';
import { registerRoutes } from './routes/index.js';
import { env } from './config/env.js';

/**
 * Middleware chain in mandatory order — Backend Spec §2:
 * helmet → cors → body parser(limited) → request id → rate limiter
 *   → requireAuth → requirePermission → requireScope → validate → handler
 *   → error handler
 */
export function createApp(): express.Express {
  const app = express();

  // SEC-17/19: use the "simple" query parser so bracket notation (`?q[$ne]=`)
  // cannot deserialize into Mongo query operators before a service sees it.
  // All consumers read flat scalar query params, so nothing relies on nesting.
  app.set('query parser', 'simple');

  applySecurity(app);
  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestId);
  app.use(globalLimiter);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'hms-backend',
      env: env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
