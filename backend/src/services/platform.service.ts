import { Types } from 'mongoose';
import { Settings, BreakGlass, type BreakGlassDoc } from '../models/platform.model.js';
import { Patient } from '../models/patient.model.js';
import { AppError } from '../errors/app-error.js';
import { audit, listAudit } from './audit.service.js';
import { enqueue } from './notification.service.js';
import { setPolicyOverrides, type FacilityPolicy } from '../config/policy.loader.js';
import { asObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Platform service — PH-08 (EP-70…77, AC-50…61).
 * - Break-glass (SEC: emergency access): mandatory reason, time-limited
 *   read-only window, immediate oversight alert, 72 h review (AC-60/61).
 * - Settings/policy engine: per-facility overrides with audited writes (EP-72).
 * - Audit viewer: admin read path over the append-only log (EP-73).
 */

// ---------------------------------------------------------------------------
// Notifications outbox (EP-79 / A-04): in-app fan-in + delivery read path
// ---------------------------------------------------------------------------

/**
 * Delivery is owned by `notification.service.drainQueue()` (single outbox
 * processor, A-04) — this module previously duplicated it and the two could
 * drift. listNotificationsForUser is the in-app read path; the background job
 * drains the queue.
 */
export async function listNotificationsForUser(actor: Actor, skip = 0, lim = 50) {
  const { Notification } = await import('../models/notification.model.js');
  const [items, total] = await Promise.all([
    Notification.find({ userId: new Types.ObjectId(actor.id) }).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
    Notification.countDocuments({ userId: new Types.ObjectId(actor.id) }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// EP-72 — settings / policy engine (PERM-62, AC-57)
// ---------------------------------------------------------------------------

const POLICY_KEYS: Array<keyof FacilityPolicy> = [
  'BOOKING_HORIZON_DAYS',
  'CANCELLATION_WINDOW_MINUTES',
  'NO_SHOW_GRACE_MINUTES',
  'WAITLIST_OFFER_MINUTES',
  'REMINDER_LEAD_HOURS',
];

export async function getPolicySettings(): Promise<Record<string, unknown>> {
  const rows = await Settings.find({ key: { $in: POLICY_KEYS.map(String) } });
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...stored, _source: 'settings-collection (env defaults when absent)' };
}

export async function setPolicySetting(
  key: string,
  value: unknown,
  actor: Actor,
  req?: ReqMeta
): Promise<Record<string, unknown>> {
  if (!(POLICY_KEYS as string[]).includes(key)) {
    throw new AppError('VALIDATION_ERROR', `Unknown policy key '${key}'.`, [
      { field: 'key', issue: `must be one of ${POLICY_KEYS.join(', ')}` },
    ]);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new AppError('VALIDATION_ERROR', 'Policy values must be non-negative numbers.', [
      { field: 'value', issue: 'must be a non-negative number' },
    ]);
  }
  await Settings.updateOne(
    { key },
    { $set: { value: num, updatedBy: actor.id } },
    { upsert: true }
  );
  // Hot-apply to the running process (A-07 seam).
  setPolicyOverrides({ [key]: num } as Partial<FacilityPolicy>);

  await audit({
    action: AUDIT_ACTIONS.POLICY_UPDATE,
    module: 'admin',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'settings',
    resourceId: key,
    req,
    details: { value: num },
  });
  return { key, value: num };
}

// ---------------------------------------------------------------------------
// EP-73 — audit viewer (PERM-63, AC-56)
// ---------------------------------------------------------------------------

export async function queryAuditLog(
  filter: { action?: string; module?: string; actorId?: string; patientId?: string },
  skip: number,
  limit: number
): Promise<{ items: unknown[]; total: number }> {
  const q: Record<string, unknown> = {};
  if (filter.action) q.action = filter.action;
  if (filter.module) q.module = filter.module;
  if (filter.actorId) q.actorId = asObjectId(filter.actorId, 'actorId');
  if (filter.patientId) q.patientId = asObjectId(filter.patientId, 'patientId');
  const { items, total } = await listAudit(q, skip, limit);
  return { items, total };
}

// ---------------------------------------------------------------------------
// EP-76/77 — break-glass (PERM-66 use, PERM-67 review; AC-60/61)
// ---------------------------------------------------------------------------

const BREAKGLASS_WINDOW_MINUTES = 60;

export async function requestBreakGlass(
  input: { patientId: string; reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<BreakGlassDoc> {
  if (actor.role !== 'doctor' && actor.role !== 'nurse') {
    throw new AppError('FORBIDDEN', 'Only clinicians can request emergency access.');
  }
  if (!input.reason || input.reason.trim().length < 10) {
    throw new AppError('VALIDATION_ERROR', 'A detailed reason (≥10 chars) is mandatory for emergency access.', [
      { field: 'reason', issue: 'min 10 chars' },
    ]);
  }
  const patient = await Patient.findById(input.patientId).select('_id');
  if (!patient) throw new AppError('NOT_FOUND', 'Patient not found.');

  const created = await BreakGlass.create({
    requesterId: actor.id,
    requesterRole: actor.role,
    patientId: patient._id,
    reason: input.reason.trim(),
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + BREAKGLASS_WINDOW_MINUTES * 60_000),
  });

  // Immediate oversight alert to every admin (AC-60).
  const { User } = await import('../models/user.model.js');
  const admins = await User.find({ role: 'admin', status: 'ACTIVE' }).select('_id');
  for (const a of admins) {
    await enqueue({
      userId: String(a._id),
      event: 'breakglass.requested',
      payload: { breakGlassId: String(created._id), requesterRole: actor.role },
    });
  }

  await audit({
    action: AUDIT_ACTIONS.BREAKGLASS_REQUEST,
    module: 'security',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'breakglass',
    resourceId: String(created._id),
    patientId: input.patientId,
    req,
    details: { reason: input.reason.trim(), expiresAt: created.expiresAt.toISOString() },
  });
  return created;
}

export async function revokeBreakGlass(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<BreakGlassDoc> {
  const bg = await BreakGlass.findById(id);
  if (!bg) throw new AppError('NOT_FOUND', 'Break-glass request not found.');
  if (bg.status !== 'ACTIVE') {
    throw new AppError('INVALID_TRANSITION', `Cannot revoke a request in status ${bg.status}.`);
  }
  // Requester or admin may revoke.
  if (bg.requesterId !== actor.id && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only the requester or an admin can revoke.');
  }
  bg.status = 'REVOKED';
  bg.revokedAt = new Date();
  bg.revokedBy = actor.id;
  await bg.save();

  await audit({
    action: AUDIT_ACTIONS.BREAKGLASS_REVOKE,
    module: 'security',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'breakglass',
    resourceId: id,
    patientId: String(bg.patientId),
    req,
  });
  return bg;
}

/** 72 h review (admin, AC-61). Overdue ACTIVE rows auto-expire first. */
export async function reviewBreakGlass(
  id: string,
  input: { notes: string },
  actor: Actor,
  req?: ReqMeta
): Promise<BreakGlassDoc> {
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only admins can review emergency access.');
  }
  await expireStaleBreakGlass();
  const bg = await BreakGlass.findById(id);
  if (!bg) throw new AppError('NOT_FOUND', 'Break-glass request not found.');
  if (bg.status === 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', 'Request is still ACTIVE — revoke or let it expire before review.');
  }
  bg.status = 'REVIEWED';
  bg.reviewedAt = new Date();
  bg.reviewedBy = actor.id;
  bg.reviewNotes = input.notes.trim();
  await bg.save();

  await audit({
    action: AUDIT_ACTIONS.BREAKGLASS_REVIEW,
    module: 'security',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'breakglass',
    resourceId: id,
    patientId: String(bg.patientId),
    req,
    details: { notes: input.notes.trim() },
  });
  return bg;
}

/** Expiry sweep (job): ACTIVE windows past expiresAt → EXPIRED. */
export async function expireStaleBreakGlass(now: Date = new Date()): Promise<number> {
  const result = await BreakGlass.updateMany(
    { status: 'ACTIVE', expiresAt: { $lt: now } },
    { $set: { status: 'EXPIRED' } }
  );
  return result.modifiedCount ?? 0;
}

/** Is the actor holding a valid break-glass window on this patient? */
export async function hasActiveBreakGlass(patientId: string, actorId: string): Promise<boolean> {
  const bg = await BreakGlass.findOne({
    requesterId: actorId,
    patientId: new Types.ObjectId(patientId),
    status: 'ACTIVE',
    expiresAt: { $gt: new Date() },
  });
  return Boolean(bg);
}

export async function listBreakGlass(actor: Actor): Promise<BreakGlassDoc[]> {
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only admins can list emergency-access requests.');
  }
  return BreakGlass.find().sort({ createdAt: -1 }).limit(200);
}
