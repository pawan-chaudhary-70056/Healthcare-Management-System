import type { RequestHandler } from 'express';
import { User } from '../models/user.model.js';
import { AppError } from '../errors/app-error.js';
import { ok } from '../helpers/response.helper.js';
import { audit } from '../services/audit.service.js';
import { encryptSecret, decryptSecret } from '../utils/encryption.js';
import { generateTotpSecret, verifyTotp, otpauthUri } from '../utils/totp.js';

/**
 * EP-07 POST /auth/mfa/enroll — generates a TOTP secret, stores it encrypted,
 * returns the otpauth:// URI (never the raw secret once enabled).
 * Auth Flow §1: "MFA required? yes, MFA not configured → force MFA enrollment".
 */
export const enroll: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AppError('SESSION_EXPIRED', 'Please sign in again.');
    const user = await User.findById(req.user.id).select('+mfa.secretEncrypted');
    if (!user) throw new AppError('SESSION_EXPIRED', 'Please sign in again.');
    if (user.mfa.enabled) {
      throw new AppError('CONFLICT', 'Multi-factor authentication is already configured.');
    }

    const secret = generateTotpSecret();
    user.mfa.secretEncrypted = encryptSecret(secret);
    // Enabled only after a successful verify (confirm ownership of the device).
    await user.save();

    await audit({
      action: 'auth.mfa_enroll',
      module: 'auth',
      actorId: String(user._id),
      actorRole: user.role,
      req,
    });

    ok(res, {
      otpauthUri: otpauthUri(secret, user.email),
      // Shown ONCE during enrollment so the user can add the account to their
      // authenticator app. Never returned again after mfa.enabled is true.
      secret,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * EP-07 POST /auth/mfa/verify — confirms enrollment with the first valid code,
 * or completes login verification when mfaPending is set on the session.
 */
export const verify: RequestHandler = async (req, res, next) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) {
      throw new AppError('VALIDATION_ERROR', 'A verification code is required.', [
        { field: 'code', issue: 'required' },
      ]);
    }

    // Case 1: completing login (user authenticated as "half-logged-in").
    const sessionUserId = req.session?.userId;
    const mfaPending = req.session?.mfaPending === true;
    if (!sessionUserId) throw new AppError('SESSION_EXPIRED', 'Please sign in again.');

    const user = await User.findById(sessionUserId).select('+mfa.secretEncrypted');
    if (!user) throw new AppError('SESSION_EXPIRED', 'Please sign in again.');

    if (!user.mfa.secretEncrypted) {
      throw new AppError('VALIDATION_ERROR', 'Multi-factor authentication is not enrolled.', [
        { field: 'code', issue: 'enrollment required first' },
      ]);
    }

    const secret = decryptSecret(user.mfa.secretEncrypted);
    if (!verifyTotp(secret, code)) {
      await audit({
        action: 'auth.mfa_verify_failed',
        module: 'auth',
        outcome: 'FAILED',
        actorId: String(user._id),
        actorRole: user.role,
        req,
      });
      throw new AppError('INVALID_CREDENTIALS', 'That code is not valid. Please try again.');
    }

    const wasPending = mfaPending;
    if (!user.mfa.enabled) {
      user.mfa.enabled = true;
      await user.save();
    }
    req.session.mfaPending = false;

    await audit({
      action: 'auth.mfa_verify',
      module: 'auth',
      actorId: String(user._id),
      actorRole: user.role,
      req,
      details: { enrollmentConfirmed: wasPending === false || undefined },
    });

    const { permissionsForRole } = await import('../config/constants.js');
    const { RoleModel } = await import('../models/role.model.js');
    const roleDoc = await RoleModel.findOne({ name: user.role });
    const permissions = roleDoc ? roleDoc.permissions : (permissionsForRole(user.role) as string[]);

    ok(res, {
      mfaComplete: true,
      user: { id: String(user._id), email: user.email, role: user.role },
      permissions,
    });
  } catch (err) {
    next(err);
  }
};
