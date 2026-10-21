import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import type { Express } from 'express';
import { env, corsOrigins } from './env.js';

/**
 * Security middleware — helmet, CORS allowlist, HTTP-only cookie sessions.
 * Session model per 02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md §4:
 * idle 30 min (sliding), absolute 12 h, server-side store, no localStorage.
 */
export function applySecurity(app: Express): void {
  app.disable('x-powered-by');
  app.use(helmet());

  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin/no-origin (curl, health checks); allowlist otherwise.
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    session({
      name: 'hms.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: env.MONGO_URI,
        ttl: 60 * 60 * 12, // 12 h absolute
        autoRemove: 'native',
      }),
      cookie: {
        httpOnly: true,
        secure: env.COOKIE_SECURE, // true behind HTTPS in production
        sameSite: 'lax',
        maxAge: 60 * 60 * 12 * 1000,
      },
    })
  );
}
