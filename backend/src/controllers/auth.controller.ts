import type { RequestHandler } from 'express';
import { User } from '../models/user.model.js';
import { RoleModel } from '../models/role.model.js';
import { verifyPassword, dummyVerify, hashPassword } from '../utils/hash.js';
import { AppError } from '../errors/app-error.js';
import { ok } from '../helpers/response.helper.js';
import { audit } from '../services/audit.service.js';
import { logger } from '../config/logger.js';

const GENERIC_LOGIN_ERROR = new AppError(
  'INVALID_CREDENTIALS',
  'Invalid email or password.'
);

/**
 * EP-01 POST /auth/login — FR-04, FR-06 (anti-enumeration), SEC-02.
 * Generic error for: unknown account, wrong password, locked/suspended account.
 */
export const login: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw GENERIC_LOGIN_ERROR;

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
    if (!user) {
      await dummyVerify();
      await audit({
        action: 'auth.login_failed',
        module: 'auth',
        outcome: 'FAILED',
        req,
        details: { reason: 'unknown_account' },
      });
      throw GENERIC_LOGIN_ERROR;
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await audit({
        action: 'auth.login_failed',
        module: 'auth',
        outcome: 'FAILED',
        actorId: String(user._id),
        actorRole: user.role,
        req,
        details: { reason: 'bad_password' },
      });
      throw GENERIC_LOGIN_ERROR;
    }

    if (user.status !== 'ACTIVE') {
      await audit({
        action: 'auth.login_failed',
        module: 'auth',
        outcome: 'FAILED',
        actorId: String(user._id),
        actorRole: user.role,
        req,
        details: { reason: user.status },
      });
      // Still generic (SEC-02) — no hint that the account exists.
      throw GENERIC_LOGIN_ERROR;
    }

    req.session.userId = String(user._id);
    req.session.role = user.role;

    // SEC-04 / FR-07 / AC-07: privileged roles without MFA configured are
    // forced through enrollment before any other API access. Configured roles
    // must verify a code to clear mfaPending.
    const { mfaIsRequiredFor } = await import('../middlewares/auth.middleware.js');
    if (mfaIsRequiredFor(user.role) && !user.mfa.enabled) {
      req.session.mfaPending = true;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      ok(res, {
        mfaRequired: true,
        enrolled: false,
        user: { id: String(user._id), email: user.email, role: user.role },
      });
      return;
    }
    if (mfaIsRequiredFor(user.role) && user.mfa.enabled) {
      req.session.mfaPending = true;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      ok(res, {
        mfaRequired: true,
        enrolled: true,
        user: { id: String(user._id), email: user.email, role: user.role },
      });
      return;
    }

    // Wait for session store write before responding.
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await audit({
      action: 'auth.login',
      module: 'auth',
      outcome: 'SUCCESS',
      actorId: String(user._id),
      actorRole: user.role,
      req,
    });

    const roleDoc = await RoleModel.findOne({ name: user.role });
    const permissions = roleDoc
      ? roleDoc.permissions
      : [];
    ok(res, {
      mfaRequired: false,
      user: {
        id: String(user._id),
        email: user.email,
        role: user.role,
        status: user.status,
      },
      permissions,
    });
  } catch (err) {
    next(err);
  }
};

/** EP-02 POST /auth/logout — invalidates session server-side; audit. */
export const logout: RequestHandler = (req, res, next) => {
  const { userId, role } = req.session ?? {};
  req.session.destroy(async (err) => {
    if (err) {
      logger.error({ err }, 'Session destroy failed');
      next(new AppError('INTERNAL', 'Could not sign out.'));
      return;
    }
    res.clearCookie('hms.sid');
    if (userId) {
      await audit({
        action: 'auth.logout',
        module: 'auth',
        outcome: 'SUCCESS',
        actorId: userId,
        actorRole: role,
        req,
      });
    }
    ok(res, { signedOut: true });
  });
};

/**
 * EP-03 GET /auth/me — profile + server-loaded permissions (never client data).
 */
export const me: RequestHandler = (req, res) => {
  ok(res, { user: req.user });
};

/**
 * EP-04 POST /auth/register — patient self-registration ONLY (role hard-coded,
 * Auth Flow §3). Staff roles are NOT selectable. PH-02 will add email
 * verification per A-02 policy.
 */
export const register: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = req.body as {
      email: string;
      password: string;
    };

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      // Generic anti-enumeration message; account creation is still refused.
      throw new AppError('VALIDATION_ERROR', 'Registration failed. Please review your details.', [
        { field: 'email', issue: 'not acceptable' },
      ]);
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'patient',
      status: 'ACTIVE',
    });

    // PH-03: registration provisions the linked patient record + privacy
    // consent (FR-12/AC-13). Consent flags recorded at account creation.
    const { Patient } = await import('../models/patient.model.js');
    const { nextMrnForUser } = await import('../services/patient.service.js');
    const { firstName = '', lastName = '', phone, dob, gender } = (req.body ?? {}) as {
      firstName?: string;
      lastName?: string;
      phone?: string;
      dob?: string;
      gender?: 'male' | 'female' | 'other';
    };
    const patient = await Patient.create({
      userId: user._id,
      mrn: await nextMrnForUser(),
      firstName: firstName || 'Patient',
      lastName: lastName || String(user._id).slice(-4),
      dob: dob ?? '1970-01-01',
      gender: gender ?? 'other',
      contacts: { phone, email: user.email },
      consentFlags: { privacy_notice: true },
      consents: [
        { type: 'privacy_notice' as const, granted: true, grantedAt: new Date(), note: 'Accepted at registration' },
      ],
    });
    await audit({
      action: 'auth.register',
      module: 'auth',
      outcome: 'SUCCESS',
      actorId: String(user._id),
      actorRole: user.role,
      req,
      details: { email: user.email },
    });

    req.session.userId = String(user._id);
    req.session.role = user.role;
    await new Promise<void>((resolve) => req.session.save(() => resolve()));

    const roleDoc = await RoleModel.findOne({ name: 'patient' });
    ok(
      res,
      {
        user: { id: String(user._id), email: user.email, role: user.role },
        patientId: String(patient._id),
        permissions: roleDoc?.permissions ?? [],
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

