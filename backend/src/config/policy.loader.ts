import { env } from './env.js';
import { logger } from './logger.js';

/**
 * policy.loader — facility policy resolution (Backend Spec §1
 * `core/policies/policy.loader.ts`). Values are NEVER hard-coded at call sites
 * (A-07): env vars provide deployment defaults; per-facility overrides will
 * live in the `settings` collection once the admin settings engine lands
 * (PH-08, EP-72) — this module is the single seam where that swap happens.
 */

export interface FacilityPolicy {
  /** Days ahead slots are offered (FR-57 / AC-63). */
  BOOKING_HORIZON_DAYS: number;
  /** Minimum minutes before slot start a patient may cancel/reschedule own. */
  CANCELLATION_WINDOW_MINUTES: number;
  /** Grace minutes after slot start before CONFIRMED → NO_SHOW (T-11). */
  NO_SHOW_GRACE_MINUTES: number;
  /** Minutes a waitlist offer stays open before expiring to the next patient. */
  WAITLIST_OFFER_MINUTES: number;
  /** Hours before an appointment when a reminder is sent (Build TODOs PH-03). */
  REMINDER_LEAD_HOURS: number;
}

const ENV_DEFAULTS: FacilityPolicy = {
  BOOKING_HORIZON_DAYS: env.BOOKING_HORIZON_DAYS,
  CANCELLATION_WINDOW_MINUTES: env.CANCELLATION_WINDOW_MINUTES,
  NO_SHOW_GRACE_MINUTES: env.NO_SHOW_GRACE_MINUTES,
  WAITLIST_OFFER_MINUTES: env.WAITLIST_OFFER_MINUTES,
  REMINDER_LEAD_HOURS: env.REMINDER_LEAD_HOURS,
};

// Future: merge per-facility overrides from `settings` (PH-08, EP-72) here.
let overrides: Partial<FacilityPolicy> = {};

/** Apply runtime policy overrides (tests / future settings engine). */
export function setPolicyOverrides(patch: Partial<FacilityPolicy>): void {
  overrides = { ...overrides, ...patch };
}

export function resetPolicyOverrides(): void {
  overrides = {};
}

export function getPolicy(): FacilityPolicy {
  return { ...ENV_DEFAULTS, ...overrides };
}

export function logPolicySnapshot(): void {
  logger.debug({ policy: getPolicy() }, 'Facility policy loaded');
}
