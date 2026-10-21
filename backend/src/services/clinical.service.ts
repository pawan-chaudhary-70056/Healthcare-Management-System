import { Types } from 'mongoose';
import {
  Encounter,
  EmrEntry,
  Prescription,
  NursingEntry,
  type EncounterDoc,
  type EmrEntryDoc,
  type PrescriptionDoc,
  type NursingEntryDoc,
} from '../models/clinical.model.js';
import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { AppError } from '../errors/app-error.js';
import { audit, auditAccessDenied } from './audit.service.js';
import { withTransaction } from '../helpers/transaction.helper.js';
import { asObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Clinical service — PH-04 (EP-30…38, FR-21…26, AC-22…27).
 * - Encounter is the only door into clinical documentation (AC-22): created by
 *   the doctor against a CHECKED_IN appointment, which moves IN_CONSULTATION
 *   (T-05) in the same transaction.
 * - EMR writes are versioned; finalized entries can only be AMENDED with a
 *   reason — originals are preserved immutably (AC-23/24, C-04).
 * - Scope: doctors access only their own encounters/patients (R-01), nurses
 *   only assigned patients (R-02); denials are audited (AC-25).
 * - Patients read only released items (PERM-25, AC-27).
 */

/** Denial auditing is shared (services/audit.service.ts) — module is the only variance. */
const auditDenied = (
  actor: Actor,
  resourceType: string,
  resourceId: string,
  patientId?: string,
  req?: ReqMeta
): Promise<void> => auditAccessDenied({ actor, module: 'clinical', resourceType, resourceId, patientId, req });

// ---------------------------------------------------------------------------
// Scope checks (R-01/R-02) — doctors: own encounters; nurses: assigned patients
// ---------------------------------------------------------------------------

export async function canAccessPatient(
  patientId: string,
  actor: Actor
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role === 'doctor') return true; // record-level check happens per encounter/patient link
  if (actor.role === 'nurse' || actor.role === 'patient') {
    const patient = await Patient.findById(patientId).select('userId assignedDoctorIds');
    if (!patient) return false;
    if (actor.role === 'patient') {
      return Boolean(patient.userId && String(patient.userId) === actor.id);
    }
    // R-02: nurses access patients whose care team (assignedDoctorIds — doctors
    // AND nurses) includes them.
    return (patient.assignedDoctorIds ?? []).some((d) => String(d) === actor.id);
  }
  return false;
}

async function assertDoctorOwnsEncounter(enc: EncounterDoc, actor: Actor): Promise<void> {
  if (String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'encounter', String(enc._id), String(enc.patientId));
    throw new AppError('FORBIDDEN', 'You can only access encounters on your own schedule.');
  }
}

// ---------------------------------------------------------------------------
// EP-30 — create encounter (doctor calls a CHECKED_IN patient)
// ---------------------------------------------------------------------------

export async function createEncounter(
  input: { appointmentId: string },
  actor: Actor,
  req?: ReqMeta
): Promise<EncounterDoc> {
  if (actor.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only doctors can start encounters.');
  }

  return withTransaction(async (session) => {
    const appt = await Appointment.findById(input.appointmentId).session(session);
    if (!appt) throw new AppError('NOT_FOUND', 'Appointment not found.');
    if (String(appt.doctorId) !== actor.id) {
      await auditDenied(actor, 'encounter', input.appointmentId, String(appt.patientId), req);
      throw new AppError('FORBIDDEN', 'You can only start encounters on your own schedule.');
    }
    if (appt.status !== 'CHECKED_IN') {
      // AC-22: encounter requires CHECKED_IN appointment (queue hand-off).
      throw new AppError('ENCOUNTER_NOT_OPEN', 'Encounters can only start from a CHECKED_IN appointment.');
    }

    const created = await Encounter.create(
      [
        {
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          departmentId: appt.departmentId,
          appointmentId: appt._id,
          status: 'OPEN',
          createdBy: actor.id,
        },
      ],
      { session }
    );
    const encounter = created[0]!;

    // Appointment T-05: CHECKED_IN → IN_CONSULTATION (same tx, lifecycle §3).
    appt.statusHistory.push({
      from: appt.status,
      to: 'IN_CONSULTATION',
      by: actor.id,
      byRole: actor.role,
      at: new Date(),
    });
    appt.status = 'IN_CONSULTATION';
    await appt.save({ session });

    // Queue token released (T-05 side effect, same as appointments.start).
    const { QueueToken } = await import('../models/appointment.model.js');
    await QueueToken.updateOne(
      { appointmentId: appt._id, status: { $in: ['WAITING', 'CALLED'] } },
      { $set: { status: 'SERVED' } }
    ).session(session);

    await audit({
      action: AUDIT_ACTIONS.ENCOUNTER_CREATE,
      module: 'clinical',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'encounter',
      resourceId: String(encounter._id),
      patientId: String(appt.patientId),
      req,
      details: { appointmentId: String(appt._id) },
    });

    return encounter;
  });
}

// ---------------------------------------------------------------------------
// EP-31 — EMR write (draft) / EP-32 finalize / EP-33 amend — versioned
// ---------------------------------------------------------------------------

export interface EmrContentInput {
  symptoms?: string;
  examination?: string;
  diagnosis?: string;
  notes?: string;
  plan?: string;
}

export async function writeEmrEntry(
  encounterId: string,
  input: EmrContentInput,
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc> {
  if (!actor.role || actor.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only doctors can write EMR entries.');
  }
  const enc = await Encounter.findById(encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  await assertDoctorOwnsEncounter(enc, actor);
  if (enc.status !== 'OPEN') {
    throw new AppError('RECORD_FINALIZED', 'The encounter is finalized — use amend for corrections.');
  }

  const entry = await EmrEntry.create({
    encounterId: enc._id,
    patientId: enc.patientId,
    authorId: actor.id,
    authorRole: actor.role,
    status: 'DRAFT',
    content: input,
    version: 1,
    versions: [{ version: 1, content: input, authorId: actor.id, authorRole: actor.role, at: new Date() }],
  });

  await audit({
    action: AUDIT_ACTIONS.EMR_WRITE,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'emr_entry',
    resourceId: String(entry._id),
    patientId: String(enc.patientId),
    req,
    details: { encounterId, version: 1 },
  });
  return entry;
}

export async function finalizeEmrEntry(
  entryId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc> {
  const entry = await EmrEntry.findById(entryId);
  if (!entry) throw new AppError('NOT_FOUND', 'EMR entry not found.');
  if (entry.authorId !== actor.id) {
    await auditDenied(actor, 'emr_entry', entryId, String(entry.patientId), req);
    throw new AppError('FORBIDDEN', 'Only the authoring doctor can finalize this entry.');
  }
  if (entry.status !== 'DRAFT') {
    throw new AppError('RECORD_FINALIZED', 'This entry is already finalized.');
  }
  entry.status = 'FINALIZED';
  entry.finalizedAt = new Date();
  await entry.save();

  await audit({
    action: AUDIT_ACTIONS.EMR_FINALIZE,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'emr_entry',
    resourceId: entryId,
    patientId: String(entry.patientId),
    req,
    details: { encounterId: String(entry.encounterId), version: entry.version },
  });
  return entry;
}

export async function amendEmrEntry(
  entryId: string,
  input: EmrContentInput & { reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'An amendment reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  const entry = await EmrEntry.findById(entryId);
  if (!entry) throw new AppError('NOT_FOUND', 'EMR entry not found.');
  if (entry.authorId !== actor.id) {
    await auditDenied(actor, 'emr_entry', entryId, String(entry.patientId), req);
    throw new AppError('FORBIDDEN', 'Only the authoring doctor can amend this entry.');
  }
  if (entry.status !== 'FINALIZED') {
    throw new AppError('VALIDATION_ERROR', 'Only finalized entries can be amended; edit the draft instead.');
  }

  // New version appended; the ORIGINAL version rows are never touched (C-04).
  const nextVersion = entry.version + 1;
  entry.versions.push({
    version: nextVersion,
    content: input,
    authorId: actor.id,
    authorRole: actor.role,
    reason: input.reason.trim(),
    at: new Date(),
  });
  entry.content = input;
  entry.version = nextVersion;
  await entry.save();

  // Encounter carries the amended marker (AC-24 trail).
  await Encounter.updateOne({ _id: entry.encounterId }, { $set: { amendedAt: new Date() } });

  await audit({
    action: AUDIT_ACTIONS.EMR_AMEND,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'emr_entry',
    resourceId: entryId,
    patientId: String(entry.patientId),
    req,
    details: { encounterId: String(entry.encounterId), version: nextVersion, reason: input.reason.trim() },
  });
  return entry;
}

// ---------------------------------------------------------------------------
// EP-34 — reads: doctor (assigned), patient (released only)
// ---------------------------------------------------------------------------

export async function getEncounterForActor(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<EncounterDoc> {
  const enc = await Encounter.findById(id);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  const allowed =
    actor.role === 'admin' ||
    (actor.role === 'doctor' && String(enc.doctorId) === actor.id);
  if (!allowed) {
    await auditDenied(actor, 'encounter', id, String(enc.patientId), req);
    throw new AppError('FORBIDDEN', "You don't have access to this encounter.");
  }
  return enc;
}

export async function listEmrForEncounter(
  encounterId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc[]> {
  const enc = await Encounter.findById(encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own || String(own._id) !== String(enc.patientId)) {
      await auditDenied(actor, 'emr_entry', encounterId, String(enc.patientId), req);
      throw new AppError('FORBIDDEN', "You don't have access to this record.");
    }
    // Patients see only released, finalized entries (AC-27, FR-25).
    return EmrEntry.find({ encounterId, status: 'FINALIZED', releasedToPatient: true }).sort({ createdAt: 1 });
  }
  if (actor.role === 'doctor' && String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'emr_entry', encounterId, String(enc.patientId), req);
    throw new AppError('FORBIDDEN', "You don't have access to this encounter.");
  }
  return EmrEntry.find({ encounterId }).sort({ createdAt: 1 });
}

/** Full version history (doctor own encounter only). */
export async function getEmrVersions(
  entryId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc['versions']> {
  const entry = await EmrEntry.findById(entryId);
  if (!entry) throw new AppError('NOT_FOUND', 'EMR entry not found.');
  const enc = await Encounter.findById(entry.encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  if (String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'emr_entry', entryId, String(entry.patientId), req);
    throw new AppError('FORBIDDEN', "You don't have access to this record's history.");
  }
  return entry.versions;
}

/** Release a finalized entry to the patient portal (AC-27 policy gate). */
export async function releaseEmrToPatient(
  entryId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<EmrEntryDoc> {
  const entry = await EmrEntry.findById(entryId);
  if (!entry) throw new AppError('NOT_FOUND', 'EMR entry not found.');
  const enc = await Encounter.findById(entry.encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  if (String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'emr_entry', entryId, String(entry.patientId), req);
    throw new AppError('FORBIDDEN', 'Only the treating doctor can release records.');
  }
  if (entry.status !== 'FINALIZED') {
    throw new AppError('RECORD_FINALIZED', 'Only finalized entries can be released.');
  }
  entry.releasedToPatient = true;
  await entry.save();
  await audit({
    action: AUDIT_ACTIONS.EMR_RELEASE,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'emr_entry',
    resourceId: entryId,
    patientId: String(entry.patientId),
    req,
  });
  return entry;
}

// ---------------------------------------------------------------------------
// EP-30b — finalize encounter (appointment → COMPLETED, T-06)
// ---------------------------------------------------------------------------

export async function finalizeEncounter(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<{ encounter: EncounterDoc; appointment: import('../models/appointment.model.js').AppointmentDoc }> {
  return withTransaction(async (session) => {
    const enc = await Encounter.findById(id).session(session);
    if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
    if (String(enc.doctorId) !== actor.id) {
      await auditDenied(actor, 'encounter', id, String(enc.patientId), req);
      throw new AppError('FORBIDDEN', 'You can only finalize your own encounters.');
    }
    if (enc.status !== 'OPEN') {
      throw new AppError('RECORD_FINALIZED', 'This encounter is already finalized.');
    }
    enc.status = 'FINALIZED';
    enc.finalizedAt = new Date();
    enc.finalizedBy = actor.id;
    await enc.save({ session });

    const appt = await Appointment.findById(enc.appointmentId).session(session);
    if (appt && appt.status === 'IN_CONSULTATION') {
      appt.statusHistory.push({
        from: appt.status,
        to: 'COMPLETED',
        by: actor.id,
        byRole: actor.role,
        at: new Date(),
      });
      appt.status = 'COMPLETED';
      appt.activeSlot = false;
      await appt.save({ session });
    }

    await audit({
      action: AUDIT_ACTIONS.ENCOUNTER_FINALIZE,
      module: 'clinical',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'encounter',
      resourceId: id,
      patientId: String(enc.patientId),
      req,
      details: { appointmentId: String(enc.appointmentId) },
    });

    return { encounter: enc, appointment: appt! };
  });
}

export async function listOpenEncounters(actor: Actor): Promise<EncounterDoc[]> {
  const query: Record<string, unknown> = { status: 'OPEN' };
  if (actor.role === 'doctor') query.doctorId = new Types.ObjectId(actor.id);
  return Encounter.find(query).sort({ createdAt: -1 }).limit(100);
}

// ---------------------------------------------------------------------------
// EP-35/36 — prescriptions (created from consultation, visible to pharmacy)
// ---------------------------------------------------------------------------

export interface PrescriptionItemInput {
  medicine: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  notes?: string;
}

export async function createPrescription(
  input: { encounterId: string; items: PrescriptionItemInput[]; validityDays?: number },
  actor: Actor,
  req?: ReqMeta
): Promise<PrescriptionDoc> {
  if (actor.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only doctors can create prescriptions.');
  }
  if (!input.items?.length) {
    throw new AppError('VALIDATION_ERROR', 'At least one medicine is required.', [
      { field: 'items', issue: 'min 1' },
    ]);
  }
  const enc = await Encounter.findById(input.encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  if (String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'prescription', input.encounterId, String(enc.patientId), req);
    throw new AppError('FORBIDDEN', 'You can only prescribe on your own encounters.');
  }

  const validityDays = Math.min(Math.max(input.validityDays ?? 30, 1), 180);
  const created = await Prescription.create({
    patientId: enc.patientId,
    encounterId: enc._id,
    doctorId: enc.doctorId,
    items: input.items,
    status: 'ACTIVE',
    dispensedQty: input.items.map(() => 0),
    expiresAt: new Date(Date.now() + validityDays * 24 * 60 * 60_000),
  });

  await audit({
    action: AUDIT_ACTIONS.PRESCRIPTION_CREATE,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'prescription',
    resourceId: String(created._id),
    patientId: String(enc.patientId),
    req,
    details: { encounterId: String(enc._id), itemCount: input.items.length },
  });
  return created;
}

export async function cancelPrescription(
  id: string,
  input: { reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<PrescriptionDoc> {
  const rx = await Prescription.findById(id);
  if (!rx) throw new AppError('NOT_FOUND', 'Prescription not found.');
  if (String(rx.doctorId) !== actor.id) {
    await auditDenied(actor, 'prescription', id, String(rx.patientId), req);
    throw new AppError('FORBIDDEN', 'Only the prescriber can cancel this prescription.');
  }
  if (rx.status !== 'ACTIVE' && rx.status !== 'PARTIALLY_DISPENSED') {
    throw new AppError('INVALID_TRANSITION', `Cannot cancel a prescription in status ${rx.status}.`);
  }
  rx.status = 'CANCELLED';
  rx.cancelledAt = new Date();
  rx.cancelledBy = actor.id;
  rx.cancelReason = input.reason.trim();
  await rx.save();

  await audit({
    action: AUDIT_ACTIONS.PRESCRIPTION_CANCEL,
    module: 'clinical',
    outcome: 'SUCCESS',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'prescription',
    resourceId: id,
    patientId: String(rx.patientId),
    req,
    details: { reason: rx.cancelReason },
  });
  return rx;
}

export async function listPrescriptionsForActor(
  filter: { patientId?: string; status?: string },
  actor: Actor
): Promise<PrescriptionDoc[]> {
  const query: Record<string, unknown> = {};
  if (actor.role === 'doctor') {
    query.doctorId = new Types.ObjectId(actor.id);
  } else if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own) return [];
    query.patientId = own._id;
  } else if (actor.role === 'pharmacist' || actor.role === 'admin') {
    if (filter.patientId) query.patientId = asObjectId(filter.patientId, 'patientId');
  }
  if (filter.status) query.status = filter.status;
  return Prescription.find(query).sort({ createdAt: -1 }).limit(200);
}

export function serializePrescription(rx: PrescriptionDoc): Record<string, unknown> {
  return {
    id: String(rx._id),
    patientId: String(rx.patientId),
    encounterId: String(rx.encounterId),
    doctorId: String(rx.doctorId),
    items: rx.items,
    dispensedQty: rx.dispensedQty,
    status: rx.status,
    expiresAt: rx.expiresAt.toISOString(),
    createdAt: rx.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// EP-37/38 — nursing entries (nurse, assigned scope)
// ---------------------------------------------------------------------------

export async function createNursingEntry(
  input: {
    patientId: string;
    encounterId?: string;
    category: 'vitals' | 'medication' | 'observation' | 'procedure';
    note: string;
    vitalSigns?: NursingEntryDoc['vitalSigns'];
  },
  actor: Actor,
  req?: ReqMeta
): Promise<NursingEntryDoc> {
  if (actor.role !== 'nurse') {
    throw new AppError('FORBIDDEN', 'Only nurses can create nursing entries.');
  }
  const allowed = await canAccessPatient(input.patientId, actor);
  if (!allowed) {
    await auditDenied(actor, 'nursing_entry', input.patientId, input.patientId, req);
    throw new AppError('FORBIDDEN', 'This patient is not assigned to you.');
  }
  if (!input.note || input.note.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'A note is required.', [{ field: 'note', issue: 'required' }]);
  }

  const entry = await NursingEntry.create({
    patientId: new Types.ObjectId(input.patientId),
    encounterId: input.encounterId ? new Types.ObjectId(input.encounterId) : undefined,
    nurseId: actor.id,
    category: input.category,
    note: input.note.trim(),
    vitalSigns: input.vitalSigns,
  });

  await audit({
    action: AUDIT_ACTIONS.NURSING_ENTRY_CREATE,
    module: 'clinical',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'nursing_entry',
    resourceId: String(entry._id),
    patientId: input.patientId,
    req,
    details: { category: input.category },
  });
  return entry;
}

export async function listNursingEntries(
  patientId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<NursingEntryDoc[]> {
  const allowed =
    actor.role === 'admin' ||
    (actor.role === 'nurse' && (await canAccessPatient(patientId, actor))) ||
    (actor.role === 'patient' && (await canAccessPatient(patientId, actor)));
  if (!allowed) {
    await auditDenied(actor, 'nursing_entry', patientId, patientId, req);
    throw new AppError('FORBIDDEN', "You don't have access to this patient's nursing records.");
  }
  return NursingEntry.find({ patientId }).sort({ createdAt: -1 }).limit(200);
}

// ---------------------------------------------------------------------------
// Serializers — wire format (ISO 8601 UTC, A-01)
// ---------------------------------------------------------------------------

export function serializeEncounter(enc: EncounterDoc): Record<string, unknown> {
  return {
    id: String(enc._id),
    patientId: String(enc.patientId),
    doctorId: String(enc.doctorId),
    departmentId: String(enc.departmentId),
    appointmentId: String(enc.appointmentId),
    status: enc.status,
    finalizedAt: enc.finalizedAt?.toISOString() ?? null,
    createdAt: enc.createdAt.toISOString(),
  };
}

export function serializeEmrEntry(
  entry: EmrEntryDoc,
  actor?: Actor
): Record<string, unknown> {
  const base = {
    id: String(entry._id),
    encounterId: String(entry.encounterId),
    patientId: String(entry.patientId),
    status: entry.status,
    content: entry.content,
    version: entry.version,
    finalizedAt: entry.finalizedAt?.toISOString() ?? null,
    releasedToPatient: entry.releasedToPatient,
    createdAt: entry.createdAt.toISOString(),
  };
  // Patients never receive version internals or the release flag detail.
  if (actor?.role === 'patient') {
    return {
      id: base.id,
      encounterId: base.encounterId,
      status: base.status,
      content: base.content,
      createdAt: base.createdAt,
    };
  }
  return base;
}

export function serializeNursingEntry(e: NursingEntryDoc): Record<string, unknown> {
  return {
    id: String(e._id),
    patientId: String(e.patientId),
    encounterId: e.encounterId ? String(e.encounterId) : null,
    category: e.category,
    note: e.note,
    vitalSigns: e.vitalSigns ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}
