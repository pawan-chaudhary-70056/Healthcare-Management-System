import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment loading + validation at boot (fail fast) — Backend Spec §1.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  MONGO_URI: z
    .string()
    .min(1)
    .default('mongodb://127.0.0.1:27017/Healthcare'),

  // 32+ random chars required in production. Fail fast if missing there.
  SESSION_SECRET: z.string().min(16),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Seed-only bootstrap admin
  ADMIN_EMAIL: z.string().email().default('admin@hms.local'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),

  // Session policy — configurable, not hard-coded (A-07, NFR-11, SEC-06)
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),

  // Privileged roles forced through MFA enrollment before dashboard access
  // (SEC-04, FR-07). Configurable per facility policy (A-07).
  MFA_REQUIRED_ROLES: z.string().default('admin'),

  // AES-256-GCM key for TOTP secret encryption at rest (mfa.secretEncrypted).
  // Generate: openssl rand -hex 32
  MFA_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default('dev-only-mfa-encryption-key-change-me-32ch'),

  // ---- Facility policy defaults (A-07: configurable, never hard-coded) ----
  // Booking horizon: how many days ahead slots are offered (FR-57/AC-63).
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  // Minimum minutes before slot start that a patient may cancel/reschedule own.
  CANCELLATION_WINDOW_MINUTES: z.coerce.number().int().min(0).max(60 * 24 * 30).default(120),
  // Minutes after slot start before an unattended CONFIRMED appointment can be
  // marked NO_SHOW (T-11 grace period).
  NO_SHOW_GRACE_MINUTES: z.coerce.number().int().min(0).max(480).default(15),
  // Minutes a waitlist offer stays open before expiring to the next patient.
  WAITLIST_OFFER_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  // Hours before an appointment when its reminder notification is sent (AC-20).
  REMINDER_LEAD_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Background scheduler cadence (Backend Spec §6).
  NOTIFICATION_DRAIN_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  REMINDER_SWEEP_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Non-empty session secret in production is a hard requirement (NFR-31). */
if (env.NODE_ENV === 'production' && env.SESSION_SECRET.includes('change-me')) {
  // eslint-disable-next-line no-console
  console.error('❌ SESSION_SECRET must be replaced in production');
  process.exit(1);
}

if (
  env.NODE_ENV === 'production' &&
  env.MFA_ENCRYPTION_KEY.startsWith('dev-only')
) {
  // eslint-disable-next-line no-console
  console.error('❌ MFA_ENCRYPTION_KEY must be replaced in production');
  process.exit(1);
}

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Roles required to complete MFA before dashboard access (SEC-04). */
export const mfaRequiredRoles = env.MFA_REQUIRED_ROLES.split(',')
  .map((r) => r.trim())
  .filter(Boolean);
