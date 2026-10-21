import type { AppointmentStatus } from '../models/appointment.model.js';

/**
 * Shared transition table — Appointment Lifecycle §3 (T-01…T-11).
 * Implementation source of truth: every status write goes through
 * `allowedTransition`; ad-hoc status edits are forbidden (Backend Spec §3.3).
 * Violations are rejected 422 INVALID_TRANSITION and audited by the caller.
 */

export type TransitionRole =
  | 'patient'
  | 'receptionist'
  | 'doctor'
  | 'admin'
  | 'system';

export interface TransitionRule {
  id: string; // T-xx
  from: readonly AppointmentStatus[];
  to: AppointmentStatus;
  roles: readonly TransitionRole[];
  /** Patient actors may only act on their own appointment (checked by caller). */
  ownOnlyForPatient?: boolean;
  /** Reason mandatory (T-09/T-10). */
  reasonRequired?: boolean;
  note?: string;
}

const PRE_CONFIRM: AppointmentStatus[] = ['REQUESTED', 'SCHEDULED', 'CONFIRMED'];

export const TRANSITIONS: TransitionRule[] = [
  { id: 'T-01', from: [], to: 'REQUESTED', roles: ['patient', 'receptionist', 'admin'], note: 'booking' },
  { id: 'T-02', from: ['REQUESTED'], to: 'SCHEDULED', roles: ['receptionist', 'admin', 'system'], note: 'slot allocated' },
  { id: 'T-03', from: ['SCHEDULED'], to: 'CONFIRMED', roles: ['receptionist', 'admin', 'system'] },
  { id: 'T-04', from: ['CONFIRMED'], to: 'CHECKED_IN', roles: ['receptionist', 'admin'] },
  { id: 'T-05', from: ['CHECKED_IN'], to: 'IN_CONSULTATION', roles: ['doctor', 'admin'], ownOnlyForPatient: false, note: 'doctor own schedule — service re-checks' },
  { id: 'T-06', from: ['IN_CONSULTATION'], to: 'COMPLETED', roles: ['doctor', 'admin'], note: 'encounter finalized' },
  { id: 'T-07', from: ['SCHEDULED', 'CONFIRMED'], to: 'RESCHEDULED', roles: ['receptionist', 'admin', 'patient'], ownOnlyForPatient: true },
  { id: 'T-08', from: ['RESCHEDULED'], to: 'SCHEDULED', roles: ['system'] },
  { id: 'T-09', from: PRE_CONFIRM, to: 'CANCELLED', roles: ['receptionist', 'admin', 'patient'], ownOnlyForPatient: true, reasonRequired: true },
  { id: 'T-10', from: ['CHECKED_IN'], to: 'CANCELLED', roles: ['admin'], reasonRequired: true, note: 'approved exception only' },
  { id: 'T-11', from: ['CONFIRMED'], to: 'NO_SHOW', roles: ['receptionist', 'doctor', 'admin'] },
];

/**
 * Look up the rule for from→to. Returns undefined when the transition is
 * prohibited (direct jumps, reverse edges, terminal states).
 */
export function findTransition(
  from: AppointmentStatus | null,
  to: AppointmentStatus
): TransitionRule | undefined {
  if (from === null) {
    return TRANSITIONS.find((t) => t.id === 'T-01' && t.to === to);
  }
  return TRANSITIONS.find((t) => t.to === to && t.from.includes(from));
}

/** Terminal states — no outgoing transitions (T-12). */
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

/** Active statuses eligible for waitlist triggers on cancel. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = PRE_CONFIRM;
