import { Types, type ClientSession } from 'mongoose';
import {
  Appointment,
  QueueToken,
  type AppointmentDoc,
  type AppointmentStatus,
} from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { AppError } from '../errors/app-error.js';
import { audit } from './audit.service.js';
import { withTransaction } from '../helpers/transaction.helper.js';
import { getPolicy } from '../config/policy.loader.js';
import { IdempotencyKey, completeIdempotencyKey } from '../utils/idempotency.js';
import { asObjectId } from '../utils/object-id.js';
import { listSlotsForDoctorDate, isSlotAvailable } from './slots.service.js';
import { findTransition, type TransitionRole } from './transition-table.js';
import { facilityDateString } from '../utils/date.js';
import { enqueue } from './notification.service.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Appointments service — EP-20…27, FR-14…20, AC-14…21.
 * Booking re-verifies slot availability INSIDE the transaction (AC-15) and
 * consumes an idempotency key atomically with the insert (AC-16). All status
 * writes go through the transition table (T-01…T-11); violations → 422.
 */

function transitionRoleOf(role: string): TransitionRole {
  if (role === 'patient') return 'patient';
  if (role === 'receptionist') return 'receptionist';
  if (role === 'doctor') return 'doctor';
  if (role === 'admin') return 'admin';
  return 'system';
}

/** Actor is allowed to run this transition role-wise? */
function roleAllowed(actor: Actor, transitionRoles: readonly TransitionRole[]): boolean {
  const r = transitionRoleOf(actor.role);
  return transitionRoles.includes(r);
}

async function auditTransition(
  action: string,
  appt: AppointmentDoc,
  actor: Actor,
  from: AppointmentStatus | null,
  to: AppointmentStatus,
  req?: ReqMeta,
  details?: Record<string, unknown>
): Promise<void> {
  await audit({
    action,
    module: 'appointments',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'appointment',
    resourceId: String(appt._id),
    patientId: String(appt.patientId),
    req,
    details: { from, to, ...details },
  });
}

/** Notification payload is privacy-trimmed: date/time/department only (NFR-16). */
async function notifyParty(
  appt: AppointmentDoc,
  event: 'appointment.booked' | 'appointment.confirmed' | 'appointment.rescheduled' | 'appointment.cancelled',
  deptName: string,
  session?: ClientSession
): Promise<void> {
  const patient = await Patient.findById(appt.patientId).session(session ?? null);
  if (!patient?.userId) return;
  await enqueue(
    {
      userId: String(patient.userId),
      event,
      payload: {
        appointmentId: String(appt._id),
        department: deptName,
        slotStartIso: appt.slot.start.toISOString(),
        slotEndIso: appt.slot.end.toISOString(),
      },
    },
    session
  );
}

// ---------------------------------------------------------------------------
// EP-21 POST /appointments — booking (T-01) with idempotency + tx re-check
// ---------------------------------------------------------------------------

export interface BookInput {
  patientId: string;
  doctorId: string;
  departmentId: string;
  slotStartIso: string;
  slotEndIso: string;
  serviceType?: string;
  reasonForVisit?: string;
  idempotencyKey: string;
}

export async function bookAppointment(
  input: BookInput,
  actor: Actor,
  req?: ReqMeta
): Promise<{ appointment: AppointmentDoc; replayed: boolean }> {
  const scope = 'appointments.book';
  const start = new Date(input.slotStartIso);
  const end = new Date(input.slotEndIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError('VALIDATION_ERROR', 'Slot times are invalid.', [
      { field: 'slotStartIso', issue: 'must be a valid ISO instant before slotEndIso' },
    ]);
  }

  // Patient self-booking: force own patient record (PERM-11, R-03).
  if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) });
    if (!own) throw new AppError('NOT_FOUND', 'No patient record is linked to your account yet.');
    if (input.patientId && String(own._id) !== input.patientId) {
      throw new AppError('FORBIDDEN', 'You can only book for your own record.');
    }
    input.patientId = String(own._id);
  }

  // Idempotency: claim the key ONCE, inside the same transaction as the insert
  // (Database Design §6). A replay of a completed request returns the stored
  // original result (AC-16). An in-flight duplicate surfaces DUPLICATE_REQUEST.
  const prior = await IdempotencyKey.findOne({ key: input.idempotencyKey, scope });
  if (prior && prior.resultStatus !== 0) {
    const body = prior.resultBody as { data?: { appointment?: { id?: string } } };
    const existing = body.data?.appointment?.id
      ? await Appointment.findById(body.data.appointment.id)
      : null;
    if (existing) return { appointment: existing, replayed: true };
  }

  try {
    const created0 = await withTransaction(async (session) => {
      // Claim the key in-tx; E11000 against an in-flight claim aborts below.
      await IdempotencyKey.create(
        [{ key: input.idempotencyKey, scope, resultStatus: 0, resultBody: {} }],
        { session }
      );

      // Validate references.
      const patient = await Patient.findById(input.patientId).session(session);
      if (!patient) {
        throw new AppError('NOT_FOUND', 'Patient not found.');
      }
      const doctor = await User.findById(input.doctorId).session(session);
      if (!doctor || doctor.role !== 'doctor') {
        throw new AppError('VALIDATION_ERROR', 'doctorId must reference an existing doctor.', [
          { field: 'doctorId', issue: 'must be an existing doctor' },
        ]);
      }
      const dept = await Department.findById(input.departmentId).session(session);
      if (!dept) throw new AppError('NOT_FOUND', 'Department not found.');

      // TRANSACTION RE-CHECK (AC-15, NFR-05): slot must still be offerable.
      const available = await isSlotAvailable(input.doctorId, start, end);
      if (!available) {
        const date = facilityDateString(start);
        const suggestions = (await listSlotsForDoctorDate(input.doctorId, date))
          .filter((s) => s.start > new Date().toISOString())
          .slice(0, 5);
        throw new AppError('SLOT_TAKEN', 'That slot is no longer available.', { suggestions, date });
      }

      const status: AppointmentStatus = 'REQUESTED'; // T-01 start state (policy may auto-schedule later)
      const created = await Appointment.create(
        [
          {
            patientId: patient._id,
            doctorId: doctor._id,
            departmentId: dept._id,
            slot: { start, end },
            serviceType: input.serviceType ?? 'consultation',
            reasonForVisit: input.reasonForVisit,
            status,
            activeSlot: true,
            idempotencyKey: input.idempotencyKey,
            bookedBy: { userId: actor.id, role: actor.role },
            statusHistory: [{ from: null, to: status, by: actor.id, byRole: actor.role, at: new Date() }],
          },
        ],
        { session }
      );
      const appointment = created[0]!;

      // Confirmation notification queued in the SAME transaction (§6) —
      // content is date/time/department only (NFR-16/AC-20).
      await notifyParty(appointment, 'appointment.booked', dept.name, session);

      appointment.appointmentNo = `APT-${appointment._id.toString().slice(-8).toUpperCase()}`;
      await appointment.save({ session });

      await audit({
        action: AUDIT_ACTIONS.APPOINTMENT_BOOK,
        module: 'appointments',
        actorId: actor.id,
        actorRole: actor.role,
        resourceType: 'appointment',
        resourceId: String(appointment._id),
        patientId: String(appointment.patientId),
        req,
        details: { transition: 'T-01', status },
      });

      return appointment;
    });

    // Store the original result so retries replay it (AC-16).
    await completeIdempotencyKey(
      { key: input.idempotencyKey, scope },
      201,
      { data: { appointment: serializeAppointment(created0) } }
    );

    return { appointment: created0, replayed: false };
  } catch (err) {
    const writeErr = err as { code?: number; codeName?: string; message?: string; writeErrors?: Array<{ code?: number }> };
    // In-flight duplicate claim of the same idempotency key → keep the client
    // retrying rather than double-writing (SEC-23).
    if (writeErr.code === 11000) {
      throw new AppError('DUPLICATE_REQUEST', 'This booking is already being processed.');
    }
    // Concurrent booking of the SAME slot: the loser's tx aborts with a write
    // conflict at commit — either E11000 via the unique active-slot index
    // (surfaced inside writeErrors) or a 112 TransientTransactionError from
    // the storage engine (AC-15, NFR-05). Both mean the slot was taken.
    const inner = writeErr.writeErrors?.[0]?.code;
    if (
      inner === 11000 ||
      writeErr.code === 112 ||
      (writeErr.codeName === 'WriteConflict' && writeErr.code === 262)
    ) {
      throw new AppError('SLOT_TAKEN', 'That slot is no longer available.');
    }
    if (
      writeErr.message?.includes('E11000') ||
      writeErr.message?.includes('WriteConflict') ||
      writeErr.message?.includes('TRANSACTION_ABORTED')
    ) {
      throw new AppError('SLOT_TAKEN', 'That slot is no longer available.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shared: load + authorize appointment access (R-01…R-03, R-09)
// ---------------------------------------------------------------------------

export async function getAppointmentForActor(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await Appointment.findById(id);
  if (!appt) throw new AppError('NOT_FOUND', 'Appointment not found.');

  const allowed =
    actor.role === 'admin' ||
    actor.role === 'receptionist' ||
    (actor.role === 'doctor' && String(appt.doctorId) === actor.id) ||
    (actor.role === 'patient' && (await isOwnPatient(appt, actor.id)));

  if (!allowed) {
    await audit({
      action: 'security.access_denied',
      module: 'appointments',
      outcome: 'DENIED',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'appointment',
      resourceId: id,
      req,
    });
    throw new AppError('FORBIDDEN', "You don't have access to this appointment.");
  }
  return appt;
}

async function isOwnPatient(appt: AppointmentDoc, userId: string): Promise<boolean> {
  const own = await Patient.findOne({ userId: new Types.ObjectId(userId) }).select('_id');
  return Boolean(own && String(own._id) === String(appt.patientId));
}

// ---------------------------------------------------------------------------
// EP-23 reschedule (T-07 → T-08) — policy window + tx slot re-check
// ---------------------------------------------------------------------------

export async function rescheduleAppointment(
  id: string,
  input: { slotStartIso: string; slotEndIso: string; reason?: string },
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await getAppointmentForActor(id, actor, req);
  const rule = findTransition(appt.status, 'RESCHEDULED');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'RESCHEDULED', req);
    throw new AppError('INVALID_TRANSITION', `Cannot reschedule an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't reschedule this appointment.");
  }

  // Patient reschedules: own + cancellation window policy (A-07).
  if (actor.role === 'patient') {
    assertOwnForPatient(appt, actor.id);
    assertWithinPolicyWindow(appt);
  }

  const newStart = new Date(input.slotStartIso);
  const newEnd = new Date(input.slotEndIso);
  if (Number.isNaN(newStart.getTime()) || newEnd <= newStart) {
    throw new AppError('VALIDATION_ERROR', 'New slot times are invalid.', [
      { field: 'slotStartIso', issue: 'must be a valid ISO instant before slotEndIso' },
    ]);
  }

  const oldAppt = await withTransaction(async (session) => {
    // Re-fetch inside tx; re-verify the NEW slot at commit time (AC-15/18).
    const fresh = await Appointment.findById(id).session(session);
    if (!fresh) throw new AppError('NOT_FOUND', 'Appointment not found.');
    const available = await isSlotAvailable(String(fresh.doctorId), newStart, newEnd);
    if (!available) {
      throw new AppError('SLOT_TAKEN', 'The new slot is not available.');
    }
    // Free the old slot by marking RESCHEDULED (T-07)…
    fresh.statusHistory.push({
      from: fresh.status,
      to: 'RESCHEDULED',
      by: actor.id,
      byRole: actor.role,
      at: new Date(),
      reason: input.reason,
    });
    fresh.status = 'RESCHEDULED';
    fresh.activeSlot = false; // frees the old slot at commit time
    await fresh.save({ session });

    // …then commit the new slot into the same doctor's calendar as a fresh
    // SCHEDULED appointment (T-08 side effect modeled directly). This keeps
    // slot occupancy atomic: the re-check above ran inside this transaction.
    const created1 = await Appointment.create(
      [
        {
          patientId: fresh.patientId,
          doctorId: fresh.doctorId,
          departmentId: fresh.departmentId,
          slot: { start: newStart, end: newEnd },
          serviceType: fresh.serviceType,
          reasonForVisit: fresh.reasonForVisit,
          status: 'SCHEDULED',
          activeSlot: true,
          bookedBy: fresh.bookedBy,
          statusHistory: [
            { from: null, to: 'REQUESTED', by: actor.id, byRole: 'system', at: new Date() },
            { from: 'RESCHEDULED', to: 'SCHEDULED', by: actor.id, byRole: 'system', at: new Date() },
          ],
        },
      ],
      { session }
    );
    const moved = created1[0]!;

    const dept = await Department.findById(fresh.departmentId).session(session);
    await notifyParty(moved, 'appointment.rescheduled', dept?.name ?? '', session);

    await audit({
      action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULE,
      module: 'appointments',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'appointment',
      resourceId: String(fresh._id),
      patientId: String(fresh.patientId),
      req,
      details: { transition: 'T-07/T-08', from: appt.status, to: 'RESCHEDULED', newAppointmentId: String(moved._id) },
    });

    return { fresh, moved };
  });
  return oldAppt.moved;
}

// ---------------------------------------------------------------------------
// EP-24 cancel (T-09/T-10) — reason mandatory, policy window for patients
// ---------------------------------------------------------------------------

export async function cancelAppointment(
  id: string,
  input: { reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await getAppointmentForActor(id, actor, req);
  const rule = findTransition(appt.status, 'CANCELLED');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'CANCELLED', req);
    throw new AppError('INVALID_TRANSITION', `Cannot cancel an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't cancel this appointment.");
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'A cancellation reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  if (actor.role === 'patient') {
    assertOwnForPatient(appt, actor.id);
    assertWithinPolicyWindow(appt);
  }

  return withTransaction(async (session) => {
    const fresh = await Appointment.findById(id).session(session);
    if (!fresh) throw new AppError('NOT_FOUND', 'Appointment not found.');
    fresh.statusHistory.push({
      from: fresh.status,
      to: 'CANCELLED',
      by: actor.id,
      byRole: actor.role,
      at: new Date(),
      reason: input.reason.trim(),
    });
    fresh.status = 'CANCELLED';
    // T-09 side effect (Lifecycle §3: "slot freed"): release the slot at the
    // uniqueness layer, or the cancelled appointment keeps occupying it in the
    // partial unique index and the slot can never be rebooked (409 on insert).
    fresh.activeSlot = false;
    await fresh.save({ session });

    const dept = await Department.findById(fresh.departmentId).session(session);
    await notifyParty(fresh, 'appointment.cancelled', dept?.name ?? '', session);
    // Slot freed → waitlist trigger handled by the waitlist service (fire-and-forget).

    await audit({
      action: AUDIT_ACTIONS.APPOINTMENT_CANCEL,
      module: 'appointments',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'appointment',
      resourceId: String(fresh._id),
      patientId: String(fresh.patientId),
      req,
      details: { transition: rule.id, reason: input.reason.trim() },
    });
    return fresh;
  });
}

// ---------------------------------------------------------------------------
// Confirm (T-03) — receptionist/admin (system auto-confirm is a policy job later)
// ---------------------------------------------------------------------------

export async function confirmAppointment(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await getAppointmentForActor(id, actor, req);

  // REQUESTED → SCHEDULED (T-02) is auto-stepped on confirm: booking already
  // allocated and re-verified the slot inside the transaction (EP-21), so the
  // UI's single Confirm action stays one step while every status write still
  // goes through the shared transition table (Lifecycle §3 — "no shortcuts"
  // means no skipped validation, not a mandatory extra click).
  if (appt.status === 'REQUESTED') {
    const t02 = findTransition('REQUESTED', 'SCHEDULED');
    if (!t02 || !roleAllowed(actor, t02.roles)) {
      throw new AppError('FORBIDDEN', "You can't confirm this appointment.");
    }
    await applyTransition(appt, 'SCHEDULED', actor, AUDIT_ACTIONS.APPOINTMENT_SCHEDULE, req, t02.id);
  }

  const rule = findTransition(appt.status, 'CONFIRMED');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'CONFIRMED', req);
    throw new AppError('INVALID_TRANSITION', `Cannot confirm an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't confirm this appointment.");
  }
  return applyTransition(appt, 'CONFIRMED', actor, AUDIT_ACTIONS.APPOINTMENT_CONFIRM, req, rule.id);
}

// ---------------------------------------------------------------------------
// Start (T-05) / complete (T-06) — doctor own schedule
// ---------------------------------------------------------------------------

export async function startConsultation(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await Appointment.findById(id);
  if (!appt) throw new AppError('NOT_FOUND', 'Appointment not found.');
  if (actor.role === 'doctor' && String(appt.doctorId) !== actor.id) {
    // Doctors drive only their own schedule (T-05 condition).
    throw new AppError('FORBIDDEN', 'You can only start consultations on your own schedule.');
  }
  const rule = findTransition(appt.status, 'IN_CONSULTATION');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'IN_CONSULTATION', req);
    throw new AppError('INVALID_TRANSITION', `Cannot start an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't start this consultation.");
  }
  const updated = await applyTransition(appt, 'IN_CONSULTATION', actor, AUDIT_ACTIONS.APPOINTMENT_START, req, rule.id);
  // Queue position released (T-05 side effect).
  await QueueToken.updateOne(
    { appointmentId: appt._id, status: { $in: ['WAITING', 'CALLED'] } },
    { $set: { status: 'SERVED' } }
  );
  return updated;
}

export async function completeConsultation(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await Appointment.findById(id);
  if (!appt) throw new AppError('NOT_FOUND', 'Appointment not found.');
  if (actor.role === 'doctor' && String(appt.doctorId) !== actor.id) {
    throw new AppError('FORBIDDEN', 'You can only complete consultations on your own schedule.');
  }
  const rule = findTransition(appt.status, 'COMPLETED');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'COMPLETED', req);
    throw new AppError('INVALID_TRANSITION', `Cannot complete an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't complete this consultation.");
  }
  return applyTransition(appt, 'COMPLETED', actor, AUDIT_ACTIONS.APPOINTMENT_COMPLETE, req, rule.id);
}

// ---------------------------------------------------------------------------
// T-11 no-show — past grace period per policy
// ---------------------------------------------------------------------------

export async function markNoShow(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<AppointmentDoc> {
  const appt = await Appointment.findById(id);
  if (!appt) throw new AppError('NOT_FOUND', 'Appointment not found.');
  const rule = findTransition(appt.status, 'NO_SHOW');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'NO_SHOW', req);
    throw new AppError('INVALID_TRANSITION', `Cannot no-show an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't mark this appointment as no-show.");
  }
  // T-11 policy: CONFIRMED may be marked NO_SHOW only after the grace window
  // past slot start (A-07 configurable NO_SHOW_GRACE_MINUTES).
  const graceCutoff = appt.slot.start.getTime() + getPolicy().NO_SHOW_GRACE_MINUTES * 60_000;
  if (Date.now() < graceCutoff) {
    throw new AppError(
      'POLICY_WINDOW',
      'No-show can be marked only after the grace period past the slot start.'
    );
  }
  return applyTransition(appt, 'NO_SHOW', actor, AUDIT_ACTIONS.APPOINTMENT_NO_SHOW, req, rule.id);
}

// ---------------------------------------------------------------------------
// EP-25 check-in (T-04) + queue token — one transaction (Database Design §6)
// ---------------------------------------------------------------------------

export async function checkIn(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<{ appointment: AppointmentDoc; token: { tokenNo: number; date: string } }> {
  const appt = await getAppointmentForActor(id, actor, req);
  const rule = findTransition(appt.status, 'CHECKED_IN');
  if (!rule) {
    await auditInvalidTransition(appt, actor, 'CHECKED_IN', req);
    throw new AppError('INVALID_TRANSITION', `Cannot check in an appointment in status ${appt.status}.`);
  }
  if (!roleAllowed(actor, rule.roles)) {
    throw new AppError('FORBIDDEN', "You can't check in this appointment.");
  }

  return withTransaction(async (session) => {
    const fresh = await Appointment.findById(id).session(session);
    if (!fresh) throw new AppError('NOT_FOUND', 'Appointment not found.');
    fresh.statusHistory.push({
      from: fresh.status,
      to: 'CHECKED_IN',
      by: actor.id,
      byRole: actor.role,
      at: new Date(),
    });
    fresh.status = 'CHECKED_IN';
    await fresh.save({ session });

    // Sequential token per doctor/day.
    const date = facilityDateString(new Date());
    const last = await QueueToken.findOne({ doctorId: fresh.doctorId, date })
      .sort({ tokenNo: -1 })
      .session(session);
    const tokenNo = (last?.tokenNo ?? 0) + 1;
    const tokenCreated = await QueueToken.create(
      [
        {
          appointmentId: fresh._id,
          patientId: fresh.patientId,
          doctorId: fresh.doctorId,
          departmentId: fresh.departmentId,
          tokenNo,
          date,
        },
      ],
      { session }
    );
    void tokenCreated[0];

    await audit({
      action: AUDIT_ACTIONS.APPOINTMENT_CHECKIN,
      module: 'appointments',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'appointment',
      resourceId: String(fresh._id),
      patientId: String(fresh.patientId),
      req,
      details: { transition: rule.id, tokenNo },
    });

    return { appointment: fresh, token: { tokenNo, date } };
  });
}

// ---------------------------------------------------------------------------
// EP-22 listings — role-scoped (AC-21)
// ---------------------------------------------------------------------------

export interface ListAppointmentsFilter {
  doctorId?: string;
  patientId?: string;
  departmentId?: string;
  status?: AppointmentStatus;
  date?: string;
}

export async function listAppointments(
  filter: ListAppointmentsFilter,
  skip: number,
  lim: number,
  actor: Actor
): Promise<{ items: AppointmentDoc[]; total: number }> {
  const query: Record<string, unknown> = {};

  // AC-21: doctor sees own schedule; nurse assigned patients; patient own only.
  if (actor.role === 'doctor') {
    query.doctorId = new Types.ObjectId(actor.id);
  } else if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own) return { items: [], total: 0 };
    query.patientId = own._id;
  } else if (actor.role === 'nurse') {
    // PH-03: nurse sees appointments of patients assigned via their own
    // patient-linked care (deepened in PH-04). Empty set until assignment UI.
    return { items: [], total: 0 };
  } else if (actor.role === 'receptionist' || actor.role === 'admin') {
    if (filter.doctorId) query.doctorId = asObjectId(filter.doctorId, 'doctorId');
    if (filter.patientId) query.patientId = asObjectId(filter.patientId, 'patientId');
    if (filter.departmentId) query.departmentId = asObjectId(filter.departmentId, 'departmentId');
  }

  if (filter.status) query.status = filter.status;
  if (filter.date) {
    const { facilitySlotStart } = await import('../utils/date.js');
    query['slot.start'] = {
      $gte: facilitySlotStart(filter.date, '00:00'),
      $lt: facilitySlotStart(filter.date, '23:59'),
    };
  }

  const [items, total] = await Promise.all([
    Appointment.find(query)
      .sort({ 'slot.start': 1 })
      .skip(skip)
      .limit(lim)
      .populate('doctorId', 'staffProfile.fullName')
      .populate('departmentId', 'name')
      .lean(),
    Appointment.countDocuments(query),
  ]);

  // Minimum-necessary: patients never see other patients' reasons (they only
  // receive their own appointments anyway, per the scope filter above).
  return { items: items as unknown as AppointmentDoc[], total };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Patients act only on their own appointments (R-03); ownership was already
 * enforced async in getAppointmentForActor (own === patient.userId match).
 * Kept as a named seam so the policy intent stays greppable at call sites. */
function assertOwnForPatient(appt: AppointmentDoc, userId: string): void {
  if (!appt || !userId) throw new AppError('FORBIDDEN', 'You can only act on your own appointments.');
}

function assertWithinPolicyWindow(appt: AppointmentDoc): void {
  const cutoff = appt.slot.start.getTime() - getPolicy().CANCELLATION_WINDOW_MINUTES * 60_000;
  if (Date.now() > cutoff) {
    throw new AppError(
      'POLICY_WINDOW',
      'This change is past the policy window. Please contact the front desk.'
    );
  }
}

async function applyTransition(
  appt: AppointmentDoc,
  to: AppointmentStatus,
  actor: Actor,
  auditAction: string,
  req?: ReqMeta,
  transitionId?: string
): Promise<AppointmentDoc> {
  const from = appt.status;
  appt.statusHistory.push({ from, to, by: actor.id, byRole: actor.role, at: new Date() });
  appt.status = to;
  // Terminal and RESCHEDULED statuses release the slot — the partial unique
  // index only covers activeSlot=true docs, so freed slots become bookable.
  if (to === 'COMPLETED' || to === 'CANCELLED' || to === 'NO_SHOW' || to === 'RESCHEDULED') {
    appt.activeSlot = false;
  }
  await appt.save();
  await auditTransition(auditAction, appt, actor, from, to, req, { transition: transitionId });
  return appt;
}

async function auditInvalidTransition(
  appt: AppointmentDoc,
  actor: Actor,
  attemptedTo: AppointmentStatus,
  req?: ReqMeta
): Promise<void> {
  await audit({
    action: AUDIT_ACTIONS.APPOINTMENT_INVALID_TRANSITION,
    module: 'appointments',
    outcome: 'FAILED',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'appointment',
    resourceId: String(appt._id),
    patientId: String(appt.patientId),
    req,
    details: { from: appt.status, attemptedTo },
  });
}

export function serializeAppointment(appt: AppointmentDoc): Record<string, unknown> {
  const base = {
    id: String(appt._id),
    patientId: String(appt.patientId),
    doctorId: String(appt.doctorId),
    departmentId: String(appt.departmentId),
    slot: { start: appt.slot.start.toISOString(), end: appt.slot.end.toISOString() },
    serviceType: appt.serviceType,
    status: appt.status,
    appointmentNo: appt.appointmentNo,
    createdAt: appt.createdAt.toISOString(),
  };
  // Preserve populated display fields when present (frontend renders
  // doctorId.staffProfile.fullName / departmentId.name from lists).
  const populated: Record<string, unknown> = {};
  const d = appt.doctorId as unknown as { staffProfile?: { fullName?: string }; _id?: unknown };
  if (d && typeof d === 'object' && 'staffProfile' in d) {
    populated.doctorId = { _id: String(d._id ?? base.doctorId), staffProfile: d.staffProfile };
  }
  const dept = appt.departmentId as unknown as { name?: string; _id?: unknown };
  if (dept && typeof dept === 'object' && 'name' in dept) {
    populated.departmentId = { _id: String(dept._id ?? base.departmentId), name: dept.name };
  }
  return { ...base, ...populated };
}
