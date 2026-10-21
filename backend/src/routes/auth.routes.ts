import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/auth.controller.js';
import * as mfa from '../controllers/mfa.controller.js';
import * as recovery from '../controllers/recovery.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginSchema, registerSchema } from '../validators/auth.validator.js';
import { authLimiter } from '../middlewares/rate-limit.middleware.js';

/**
 * Auth routes — API Standards §3.1 (EP-01..07).
 * Every route declares its auth requirement (Backend Spec §4).
 * Rate-limited per SEC-03; recovery responses neutral per SEC-02.
 */
export const authRouter = Router();

authRouter.post('/login', authLimiter, validate(loginSchema), controller.login);
authRouter.post('/register', authLimiter, validate(registerSchema), controller.register);
authRouter.post('/logout', requireAuth, controller.logout);
authRouter.get('/me', requireAuth, controller.me);

// Password recovery — EP-05/06 (public, rate-limited, anti-enumeration)
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ email: z.string().email() })),
  recovery.forgotPassword
);
authRouter.post(
  '/reset-password',
  authLimiter,
  validate(
    z.object({
      token: z.string().min(16),
      password: z
        .string()
        .min(10)
        .regex(/[A-Z]/, 'Password must contain an uppercase letter')
        .regex(/[a-z]/, 'Password must contain a lowercase letter')
        .regex(/[0-9]/, 'Password must contain a digit'),
    })
  ),
  recovery.resetPassword
);

// MFA — EP-07 (privileged users; enrollment requires an authenticated session)
authRouter.post('/mfa/enroll', requireAuth, mfa.enroll);
authRouter.post(
  '/mfa/verify',
  validate(z.object({ code: z.string().min(6).max(10) })),
  mfa.verify
);
