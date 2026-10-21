import { randomBytes, createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { User } from '../models/user.model.js';
import { AppError } from '../errors/app-error.js';
import { ok } from '../helpers/response.helper.js';
import { audit } from '../services/audit.service.js';
import { hashPassword } from '../utils/hash.js';
import { destroyAllSessionsForUser } from '../utils/session.js';

/** Single-use, time-limited reset token (Auth Flow §2): 30 min default. */
const RESET_TOKEN_TTL_MS = 30 * 60_000;

/** Reset tokens are stored hashed — a DB leak cannot be replayed. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * EP-05 POST /auth/forgot-password — always the same neutral response whether
 * or not the account exists (SEC-02, FR-06, AC-06). Audit both paths.
 */
export const forgotPassword: RequestHandler = async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    const neutral = {
      message:
        'If the address is registered, a reset link has been sent. Please check your inbox.',
    };

    if (email) {
      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (user) {
        const token = randomBytes(32).toString('hex');
        user.passwordResetTokenHash = hashToken(token);
        user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await user.save();

        // A-04: email provider integration lands with the notifications stack
        // (PH-08). Until then the token is logged server-side ONLY in
        // non-production for manual delivery testing — never in production.
        const { env } = await import('../config/env.js');
        const { logger } = await import('../config/logger.js');
        if (env.NODE_ENV !== 'production') {
          logger.warn({ email: user.email, resetToken: token }, 'DEV-ONLY password reset token');
        }

        await audit({
          action: 'auth.password_reset_requested',
          module: 'auth',
          actorId: String(user._id),
          actorRole: user.role,
          req,
        });
      } else {
        // Same audit shape, no account — do not reveal via audit timing.
        await audit({
          action: 'auth.password_reset_requested',
          module: 'auth',
          outcome: 'SUCCESS',
          req,
        });
      }
    }

    ok(res, neutral);
  } catch (err) {
    next(err);
  }
};

/**
 * EP-06 POST /auth/reset-password — single-use token; invalidates all existing
 * sessions after reset (Auth Flow §2).
 */
export const resetPassword: RequestHandler = async (req, res, next) => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token || !password) {
      throw new AppError('VALIDATION_ERROR', 'A reset token and new password are required.', [
        { field: 'token', issue: !token ? 'required' : 'valid' },
        { field: 'password', issue: !password ? 'required' : 'valid' },
      ]);
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetTokenHash +passwordResetExpires');

    if (!user) {
      throw new AppError('VALIDATION_ERROR', 'This reset link is invalid or has expired.', [
        { field: 'token', issue: 'invalid or expired' },
      ]);
    }

    user.passwordHash = await hashPassword(password);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    // Force fresh login everywhere (Auth Flow §2 step 3).
    await destroyAllSessionsForUser(String(user._id));
    await user.save();

    await audit({
      action: 'auth.password_reset_completed',
      module: 'auth',
      actorId: String(user._id),
      actorRole: user.role,
      req,
    });

    ok(res, { message: 'Your password has been updated. Please sign in with your new password.' });
  } catch (err) {
    next(err);
  }
};
