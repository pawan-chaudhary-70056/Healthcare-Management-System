import { Types } from 'mongoose';
import {
  WaitlistEntry,
  type WaitlistEntryDoc,
  type WaitlistStatus,
} from '../models/waitlist.model.js';
import { AppError } from '../errors/app-error.js';
import { audit } from './audit.service.js';
import { getPolicy } from '../config/policy.loader.js';
import { enqueue } from './notification.service.js';
import { facilityDateString } from '../utils/date.js';
import { asObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from '../config/constants.js';

/**
 * Waitlist — Patient Appointment Workflow §5, EP-27, FR-18.
 * Join/leave audited; when a slot frees (cancel/reschedule), offers are made
 * per policy order (priority, then join time); offers expire after the
 * configured window and the next patient is offered.
 */

export interface Actor {
  id: string;
  role: string;
}

export async function join(
  input: { patientId?: string; doctorId: string; departmentId: string; date: string },
  actor: Actor,
  req?: { ip?: string; headers?: Record<string, unknown> }
): Promise<WaitlistEntryDoc> {
  const { Patient } = await import('../models/patient.model.js');
  let patientId = input.patientId;
  if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own) throw new AppError('NOT_FOUND', 'No patient record is linked to your account yet.');
    if (input.patientId && String(own._id) !== input.patientId) {
      throw new AppError('FORBIDDEN', 'You can only join the waitlist for your own record.');
    }
    patientId = String(own._id);
  } else if (!patientId) {
    throw new AppError('VALIDATION_ERROR', 'patientId is required.', [
      { field: 'patientId', issue: 'required' },
    ]);
  }

  // One active entry per patient/doctor/date.
  const existing = await WaitlistEntry.findOne({
    patientId: new Types.ObjectId(patientId),
    doctorId: new Types.ObjectId(input.doctorId),
    date: input.date,
    status: { $in: ['WAITING', 'OFFERED'] },
  });
  if (existing) return existing;

  const entry = await WaitlistEntry.create({
    patientId: new Types.ObjectId(patientId),
    doctorId: new Types.ObjectId(input.doctorId),
    departmentId: new Types.ObjectId(input.departmentId),
    date: input.date,
    priority: Date.now(), // policy order: join time
  });

  await audit({
    action: AUDIT_ACTIONS.WAITLIST_JOIN,
    module: 'appointments',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'waitlist_entry',
    resourceId: String(entry._id),
    patientId,
    req,
  });
  return entry;
}

export async function leave(
  id: string,
  actor: Actor,
  req?: { ip?: string; headers?: Record<string, unknown> }
): Promise<void> {
  const entry = await WaitlistEntry.findById(id);
  if (!entry) throw new AppError('NOT_FOUND', 'Waitlist entry not found.');
  if (actor.role === 'patient') {
    const { Patient } = await import('../models/patient.model.js');
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own || String(own._id) !== String(entry.patientId)) {
      throw new AppError('FORBIDDEN', "You can only remove your own waitlist entries.");
    }
  }
  entry.status = 'LEFT';
  entry.resolvedAt = new Date();
  await entry.save();
  await audit({
    action: AUDIT_ACTIONS.WAITLIST_LEAVE,
    module: 'appointments',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'waitlist_entry',
    resourceId: String(entry._id),
    patientId: String(entry.patientId),
    req,
  });
}

/**
 * Offer freed slots: called after a cancellation frees capacity. Offers the
 * earliest-expiring policy-ordered waiting entry a slot suggestion; the entry
 * expires after WAITLIST_OFFER_MINUTES and the next patient is offered.
 */
export async function offerFreedSlot(
  doctorId: string,
  date: string
): Promise<void> {
  const { listSlotsForDoctorDate } = await import('./slots.service.js');
  const slots = await listSlotsForDoctorDate(doctorId, date);
  if (slots.length === 0) return;

  // Expire stale offers first.
  await expireStaleOffers();

  const waiting = await WaitlistEntry.find({ doctorId: new Types.ObjectId(doctorId), date, status: 'WAITING' })
    .sort({ priority: 1, joinedAt: 1 })
    .limit(1);
  const next = waiting[0];
  if (!next) return;

  const slot = slots[0];
  if (!slot) return;
  next.status = 'OFFERED';
  next.offeredSlotStart = new Date(slot.start);
  next.offerExpiresAt = new Date(Date.now() + getPolicy().WAITLIST_OFFER_MINUTES * 60_000);
  await next.save();

  const { Patient } = await import('../models/patient.model.js');
  const patient = await Patient.findById(next.patientId);
  if (patient?.userId) {
    await enqueue({
      userId: String(patient.userId),
      event: 'appointment.waitlist_offer',
      payload: {
        department: undefined,
        slotStartIso: slot.start,
        slotEndIso: slot.end,
      },
    });
  }

  await audit({
    action: AUDIT_ACTIONS.WAITLIST_OFFER,
    module: 'appointments',
    resourceType: 'waitlist_entry',
    resourceId: String(next._id),
    patientId: String(next.patientId),
    details: { slotStart: slot.start },
  });
}

/** Expire offers past their window; those entries return to WAITING→EXPIRED. */
export async function expireStaleOffers(): Promise<number> {
  const now = new Date();
  const stale = await WaitlistEntry.find({ status: 'OFFERED', offerExpiresAt: { $lte: now } });
  for (const entry of stale) {
    entry.status = 'EXPIRED';
    entry.resolvedAt = now;
    await entry.save();
  }
  return stale.length;
}

export async function listWaitlist(
  filter: { doctorId?: string; date?: string },
  actor: Actor
): Promise<Array<Record<string, unknown>>> {
  void actor;
  const query: Record<string, unknown> = {};
  if (filter.doctorId) query.doctorId = asObjectId(filter.doctorId, 'doctorId');
  if (filter.date) query.date = filter.date;
  const items = await WaitlistEntry.find(query)
    .sort({ priority: 1, joinedAt: 1 })
    .lean();
  return items.map((e) => ({
    id: String(e._id),
    patientId: String(e.patientId),
    doctorId: String(e.doctorId),
    date: e.date,
    status: e.status as WaitlistStatus,
    joinedAt: e.joinedAt.toISOString(),
    offeredSlotStart: e.offeredSlotStart?.toISOString(),
    offerExpiresAt: e.offerExpiresAt?.toISOString(),
  }));
}

/** Facility-local "today" helper reused by routes. */
export function today(): string {
  return facilityDateString(new Date());
}