import type { RequestHandler } from 'express';
import { User } from '../models/user.model.js';
import { RoleModel } from '../models/role.model.js';
import { permissionsForRole } from '../config/constants.js';
import { AppError } from '../errors/app-error.js';
import { dummyVerify } from '../utils/hash.js';
import { checkAndStampIdle, type SessionDataLike } from '../utils/session.js';
import { mfaRequiredRoles } from '../config/env.js';

/**
 * requireAuth — session → user + permissions loaded from the DB on every
 * protected request (Auth Flow §4/§5). 401 SESSION_EXPIRED on failure.
 * Includes idle timeout enforcement (SEC-06, NFR-11, AC-08).
 * Permissions are NEVER taken from the client (C-02, SEC-07).
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    // Idle timeout: beyond the configured window the session must re-authenticate.
    if (!checkAndStampIdle(req.session as unknown as SessionDataLike)) {
      req.session.destroy(() => {});
      throw new AppError('SESSION_EXPIRED', 'You were signed out after a period of inactivity. Please sign in again.');
    }
    const user = await User.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      req.session.destroy(() => {});
      throw new AppError('SESSION_EXPIRED', 'Your session is no longer valid. Please sign in again.');
    }
    const roleDoc = await RoleModel.findOne({ name: user.role });
    const permissions = roleDoc ? roleDoc.permissions : (permissionsForRole(user.role) as string[]);
    req.user = { id: String(user._id), email: user.email, role: user.role, permissions };

    // MFA challenge outstanding: only MFA endpoints (and logout) stay reachable
    // (SEC-04, AC-07). Everything else — including /auth/me — is blocked.
    if (req.session?.mfaPending) {
      const url = req.originalUrl ?? '';
      const mfaOrLogout = url.includes('/auth/mfa/') || url.includes('/auth/logout');
      if (!mfaOrLogout) {
        next(new AppError('MFA_REQUIRED', 'Multi-factor authentication must be completed first.'));
        return;
      }
    }
    next();
  } catch (err) {
    // Keep timing similar for missing session vs bad user (cheap anti-probe).
    await dummyVerify();
    next(err);
  }
};

/**
 * requireMfaComplete — privileged roles must finish MFA enrollment/verification
 * before any non-auth API access (SEC-04, FR-07, AC-07). Mounted app-wide for
 * /api/v1 except /auth/*.
 */
export const requireMfaComplete: RequestHandler = (req, _res, next) => {
  if (req.session?.mfaPending) {
    next(new AppError('MFA_REQUIRED', 'Multi-factor authentication must be completed first.'));
    return;
  }
  next();
};

/** True when the role is configured to require MFA (SEC-04). */
export function mfaIsRequiredFor(role: string): boolean {
  return mfaRequiredRoles.includes(role);
}
