import { Types } from 'mongoose';
import {
  LabOrder,
  LabTest,
  type LabOrderDoc,
  type LabResultValue,
} from '../models/lab.model.js';
import { Encounter } from '../models/clinical.model.js';
import { Patient } from '../models/patient.model.js';
import { AppError } from '../errors/app-error.js';
import { audit, auditAccessDenied } from './audit.service.js';
import { withTransaction } from '../helpers/transaction.helper.js';
import { asObjectId } from '../utils/object-id.js';
import { enqueue } from './notification.service.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Lab service — PH-05 (EP-40…46, FR-25…32, AC-28…34).
 * Status ladder enforces separable duties: entry (PERM-32) ≠ verification
 * (PERM-33). Unverified results are NEVER visible to patients (NFR-17).
 * Critical results follow detect → notify → ack → escalate (AC-32).
 */

/** Denial auditing is shared (services/audit.service.ts) — module is the only variance. */
const auditDenied = (
  actor: Actor,
  resourceType: string,
  resourceId: string,
  patientId?: string,
  req?: ReqMeta
): Promise<void> => auditAccessDenied({ actor, module: 'lab', resourceType, resourceId, patientId, req });

// ---------------------------------------------------------------------------
// EP-40 — create order (doctor, on own encounter) + billing charge (AC-34)
// ---------------------------------------------------------------------------

export async function createLabOrder(
  input: { encounterId: string; testCode: string; priority?: 'routine' | 'urgent' },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only doctors can order lab tests.');
  }
  const enc = await Encounter.findById(input.encounterId);
  if (!enc) throw new AppError('NOT_FOUND', 'Encounter not found.');
  if (String(enc.doctorId) !== actor.id) {
    await auditDenied(actor, 'lab_order', input.encounterId, String(enc.patientId), req);
    throw new AppError('FORBIDDEN', 'You can only order tests on your own encounters.');
  }

  const test = await LabTest.findOne({ code: input.testCode, active: true });
  if (!test) {
    throw new AppError('VALIDATION_ERROR', 'Unknown or inactive test code.', [
      { field: 'testCode', issue: 'must be an active catalog code' },
    ]);
  }

  return withTransaction(async (session) => {
    const created = await LabOrder.create(
      [
        {
          patientId: enc.patientId,
          encounterId: enc._id,
          doctorId: enc.doctorId,
          testCode: test.code,
          testName: test.name,
          priority: input.priority ?? 'routine',
          status: 'ORDERED',
        },
      ],
      { session }
    );
    const order = created[0]!;

    // AC-34: billing charge auto-linked (PH-07 consolidates charges → invoice).
    const { Charge } = await import('../models/billing.model.js');
    const charge = await Charge.create(
      [
        {
          patientId: enc.patientId,
          encounterId: enc._id,
          sourceType: 'LAB',
          sourceId: order._id,
          description: `Lab: ${test.name}`,
          amountMinor: test.priceMinor,
          quantity: 1,
        },
      ],
      { session }
    );
    order.chargeId = charge[0]!._id;
    await order.save({ session });

    await audit({
      action: AUDIT_ACTIONS.LAB_ORDER_CREATE,
      module: 'lab',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'lab_order',
      resourceId: String(order._id),
      patientId: String(enc.patientId),
      req,
      details: { testCode: test.code, encounterId: String(enc._id) },
    });
    return order;
  });
}

export async function cancelLabOrder(
  id: string,
  input: { reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  const allowed =
    (actor.role === 'doctor' && String(order.doctorId) === actor.id) || actor.role === 'admin';
  if (!allowed) {
    await auditDenied(actor, 'lab_order', id, String(order.patientId), req);
    throw new AppError('FORBIDDEN', 'Only the ordering doctor can cancel.');
  }
  // Cancellation only before results are entered.
  if (!['ORDERED', 'SPECIMEN_COLLECTED', 'IN_PROCESS'].includes(order.status)) {
    throw new AppError('INVALID_TRANSITION', `Cannot cancel an order in status ${order.status}.`);
  }
  order.status = 'CANCELLED';
  order.cancelledAt = new Date();
  order.cancelledBy = actor.id;
  order.cancelReason = input.reason.trim();
  await order.save();

  await audit({
    action: AUDIT_ACTIONS.LAB_ORDER_CANCEL,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { reason: order.cancelReason },
  });
  return order;
}

// ---------------------------------------------------------------------------
// EP-41 — specimen recording + chain of custody (PERM-31)
// ---------------------------------------------------------------------------

export async function recordSpecimen(
  id: string,
  input: { specimenId: string; type: string; collectedAt?: string },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech') {
    throw new AppError('FORBIDDEN', 'Only lab staff can record specimens.');
  }
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  if (order.status !== 'ORDERED') {
    throw new AppError('INVALID_TRANSITION', `Specimen can only be recorded on ORDERED orders (current: ${order.status}).`);
  }
  if (!input.specimenId || !input.type) {
    throw new AppError('VALIDATION_ERROR', 'specimenId and type are required.', [
      { field: 'specimenId', issue: 'required' },
      { field: 'type', issue: 'required' },
    ]);
  }

  order.specimen = {
    specimenId: input.specimenId,
    type: input.type,
    collectedAt: input.collectedAt ? new Date(input.collectedAt) : new Date(),
    collectedBy: actor.id,
    custody: [{ at: new Date(), by: actor.id, action: 'COLLECTED' }],
  };
  order.status = 'SPECIMEN_COLLECTED';
  await order.save();

  await audit({
    action: AUDIT_ACTIONS.LAB_SPECIMEN_RECORD,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { specimenId: input.specimenId, type: input.type },
  });
  return order;
}

/** Chain-of-custody append (AC-29). */
export async function addCustodyEntry(
  id: string,
  action: string,
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech') {
    throw new AppError('FORBIDDEN', 'Only lab staff can update chain of custody.');
  }
  const order = await LabOrder.findById(id);
  // Mongoose materializes an empty specimen subdoc — check the leaf field, not
  // truthiness (same class of bug fixed in the serializer).
  if (!order?.specimen?.collectedAt) {
    throw new AppError('NOT_FOUND', 'Specimen not recorded yet.');
  }
  order.specimen.custody.push({ at: new Date(), by: actor.id, action });
  await order.save();
  await audit({
    action: AUDIT_ACTIONS.LAB_SPECIMEN_RECORD,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { custodyAction: action },
  });
  return order;
}

// ---------------------------------------------------------------------------
// EP-42 — result entry (PERM-32) → status RESULT_ENTERED (invisible to patient)
// ---------------------------------------------------------------------------

export async function enterResults(
  id: string,
  input: { values: LabResultValue[]; notes?: string },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech') {
    throw new AppError('FORBIDDEN', 'Only lab staff can enter results.');
  }
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  if (!['SPECIMEN_COLLECTED', 'IN_PROCESS'].includes(order.status)) {
    throw new AppError('INVALID_TRANSITION', `Results can only be entered after specimen collection (current: ${order.status}).`);
  }
  if (!input.values?.length) {
    throw new AppError('VALIDATION_ERROR', 'At least one result value is required.', [
      { field: 'values', issue: 'min 1' },
    ]);
  }

  const test = await LabTest.findOne({ code: order.testCode });
  // Critical detection (AC-32): value outside configured thresholds.
  const isCritical = input.values.some((v) => {
    const rule = test?.criticalRules?.find((r) => r.name === v.name);
    if (!rule) return v.flag === 'critical';
    const num = Number(v.value);
    if (Number.isNaN(num)) return v.flag === 'critical';
    if (rule.min !== undefined && num < rule.min) return true;
    if (rule.max !== undefined && num > rule.max) return true;
    return false;
  });

  order.results = {
    values: input.values,
    notes: input.notes,
    enteredBy: actor.id,
    enteredAt: new Date(),
    isCritical,
    versions: [
      {
        version: 1,
        values: input.values,
        notes: input.notes,
        authorId: actor.id,
        authorRole: actor.role,
        at: new Date(),
      },
    ],
  };
  // IN_PROCESS is auto-passed: specimen → entry is the lab's own lane; every
  // write still lands in an allowed canonical status (RESULT_ENTERED).
  order.status = 'RESULT_ENTERED';
  await order.save();

  await audit({
    action: AUDIT_ACTIONS.LAB_RESULT_ENTER,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { isCritical, valueCount: input.values.length },
  });

  if (isCritical) await notifyCritical(order, req);
  return order;
}

/** Critical path: alert ordering clinician in-app + record the event (AC-32). */
async function notifyCritical(order: LabOrderDoc, req?: ReqMeta): Promise<void> {
  const doctor = await Patient.db.model('User').findById(order.doctorId);
  if (!doctor) return;
  const now = new Date();
  order.results!.critical = {
    detectedAt: now,
    notifiedUserId: String(doctor._id),
    notifiedAt: now,
    escalationLevel: 0,
  };
  await order.save();
  await enqueue({
    userId: String(doctor._id),
    event: 'lab.critical_result',
    payload: {
      orderId: String(order._id),
      testName: order.testName,
      patientMrnMasked: 'on-file',
    },
  });
  await audit({
    action: AUDIT_ACTIONS.LAB_CRITICAL_ALERT,
    module: 'lab',
    actorId: 'system',
    actorRole: 'system',
    resourceType: 'lab_order',
    resourceId: String(order._id),
    patientId: String(order.patientId),
    req,
    details: { notifiedUserId: String(doctor._id) },
  });
}

// ---------------------------------------------------------------------------
// EP-43 — verification (PERM-33), separable from entry (policy-configurable)
// ---------------------------------------------------------------------------

export async function verifyResults(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech') {
    throw new AppError('FORBIDDEN', 'Only lab staff can verify results.');
  }
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  // RESULT_ENTERED = first verification; AMENDED = mandatory re-verification (AC-33).
  if (!['RESULT_ENTERED', 'AMENDED'].includes(order.status) || !order.results) {
    throw new AppError('INVALID_TRANSITION', 'Results must be entered (or amended) before verification.');
  }
  // Separable duties (§2): verifier ≠ entry author.
  if (order.results.enteredBy === actor.id) {
    throw new AppError('FORBIDDEN', 'Verification requires a different person than the result author.');
  }

  order.results.verifiedBy = actor.id;
  order.results.verifiedAt = new Date();
  order.status = 'VERIFIED';
  await order.save();

  await audit({
    action: AUDIT_ACTIONS.LAB_RESULT_VERIFY,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { enteredBy: order.results.enteredBy },
  });
  return order;
}

// ---------------------------------------------------------------------------
// EP-46 — critical acknowledgment + escalation sweep
// ---------------------------------------------------------------------------

export async function acknowledgeCritical(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  const order = await LabOrder.findById(id);
  if (!order?.results?.critical) throw new AppError('NOT_FOUND', 'No critical result pending on this order.');
  if (order.results.critical.acknowledgedAt) {
    throw new AppError('VALIDATION_ERROR', 'Critical result already acknowledged.');
  }
  order.results.critical.acknowledgedAt = new Date();
  order.results.critical.acknowledgedBy = actor.id;
  await order.save();
  await audit({
    action: AUDIT_ACTIONS.LAB_CRITICAL_ACK,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
  });
  return order;
}

/** Escalation sweep (job): unacknowledged criticals bump escalation level. */
export async function escalateUnacknowledgedCriticals(olderThanMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const pending = await LabOrder.find({
    'results.isCritical': true,
    'results.critical.acknowledgedAt': { $exists: false },
    'results.critical.notifiedAt': { $lt: cutoff },
    status: { $in: ['RESULT_ENTERED', 'VERIFIED', 'RELEASED'] },
  }).limit(200);
  let escalated = 0;
  for (const order of pending) {
    order.results!.critical!.escalationLevel += 1;
    order.results!.critical!.escalatedAt = new Date();
    await order.save();
    await audit({
      action: AUDIT_ACTIONS.LAB_CRITICAL_ALERT,
      module: 'lab',
      actorId: 'system',
      actorRole: 'system',
      resourceType: 'lab_order',
      resourceId: String(order._id),
      patientId: String(order.patientId),
      details: { escalationLevel: order.results!.critical!.escalationLevel },
    });
    escalated += 1;
  }
  return escalated;
}

// ---------------------------------------------------------------------------
// EP-44 — release (PERM-34): status-gated VERIFIED; critical ack enforced
// ---------------------------------------------------------------------------

export async function releaseResults(
  id: string,
  input: { releaseToPatient: boolean },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only lab staff can release results.');
  }
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  if (order.status !== 'VERIFIED') {
    throw new AppError('RESULT_NOT_VERIFIED', 'Results must be VERIFIED before release.');
  }
  // AC-32: a critical result must be acknowledged before it is released.
  if (order.results?.isCritical && !order.results.critical?.acknowledgedAt) {
    throw new AppError('CRITICAL_ACK_REQUIRED', 'Critical result must be acknowledged before release.');
  }
  order.results!.releasedAt = new Date();
  order.results!.releasedToPatient = input.releaseToPatient;
  order.status = 'RELEASED';
  await order.save();

  await audit({
    action: AUDIT_ACTIONS.LAB_RESULT_RELEASE,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { releaseToPatient: input.releaseToPatient },
  });
  return order;
}

// ---------------------------------------------------------------------------
// EP-45 — amendments: new version, original preserved, re-verification required
// ---------------------------------------------------------------------------

export async function amendResults(
  id: string,
  input: { values: LabResultValue[]; notes?: string; reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  if (actor.role !== 'lab_tech') {
    throw new AppError('FORBIDDEN', 'Only lab staff can amend results.');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'An amendment reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  const order = await LabOrder.findById(id);
  if (!order?.results) throw new AppError('NOT_FOUND', 'No results to amend.');
  if (!['VERIFIED', 'RELEASED', 'AMENDED'].includes(order.status)) {
    throw new AppError('INVALID_TRANSITION', `Cannot amend results in status ${order.status}.`);
  }

  const nextVersion = order.results.versions.length + 1;
  order.results.versions.push({
    version: nextVersion,
    values: input.values,
    notes: input.notes,
    authorId: actor.id,
    authorRole: actor.role,
    reason: input.reason.trim(),
    at: new Date(),
  });
  order.results.values = input.values;
  order.results.notes = input.notes;
  // Re-verification required (AC-33): clear the verified stamps, back to entry.
  order.results.verifiedBy = undefined;
  order.results.verifiedAt = undefined;
  order.results.releasedAt = undefined;
  order.results.releasedToPatient = false;
  order.status = 'AMENDED';

  await order.save();
  await audit({
    action: AUDIT_ACTIONS.LAB_RESULT_AMEND,
    module: 'lab',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'lab_order',
    resourceId: id,
    patientId: String(order.patientId),
    req,
    details: { version: nextVersion, reason: input.reason.trim() },
  });
  return order;
}

// ---------------------------------------------------------------------------
// EP-34/36 reads — scope-checked; patients see RELEASED+releasedToPatient only
// ---------------------------------------------------------------------------

export async function getLabOrderForActor(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<LabOrderDoc> {
  const order = await LabOrder.findById(id);
  if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
  const allowed =
    actor.role === 'admin' ||
    actor.role === 'lab_tech' ||
    (actor.role === 'doctor' && String(order.doctorId) === actor.id) ||
    (await isOwnPatientOrder(order, actor));
  if (!allowed) {
    await auditDenied(actor, 'lab_order', id, String(order.patientId), req);
    throw new AppError('FORBIDDEN', "You don't have access to this lab order.");
  }
  // Patient projection: released results only (NFR-17, FR-25, AC-30).
  if (actor.role === 'patient') {
    const visible =
      order.status === 'RELEASED' &&
      order.results?.releasedToPatient === true;
    if (!visible) {
      // Not an error — an empty/hidden result is the contract (0 violations).
      const hidden = await LabOrder.findById(id).select('_id status testName createdAt');
      return hidden!;
    }
  }
  return order;
}

async function isOwnPatientOrder(order: LabOrderDoc, actor: Actor): Promise<boolean> {
  if (actor.role !== 'patient') return false;
  const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
  return Boolean(own && String(own._id) === String(order.patientId));
}

export async function listLabOrdersForActor(
  filter: { patientId?: string; status?: string },
  actor: Actor
): Promise<LabOrderDoc[]> {
  const query: Record<string, unknown> = {};
  if (actor.role === 'doctor') {
    query.doctorId = new Types.ObjectId(actor.id);
  } else if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own) return [];
    query.patientId = own._id;
    // Patients only ever see RELEASED orders with released results (NFR-17).
    query.status = 'RELEASED';
    query['results.releasedToPatient'] = true;
  } else if (actor.role === 'admin') {
    if (filter.patientId) query.patientId = asObjectId(filter.patientId, 'patientId');
  } else if (actor.role === 'lab_tech') {
    // Lab staff work the whole queue.
  }
  if (filter.status && actor.role !== 'patient') query.status = filter.status;
  return LabOrder.find(query).sort({ createdAt: -1 }).limit(200);
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

export function serializeLabOrder(order: LabOrderDoc, actor?: Actor): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: String(order._id),
    patientId: String(order.patientId),
    encounterId: String(order.encounterId),
    doctorId: String(order.doctorId),
    testCode: order.testCode,
    testName: order.testName,
    priority: order.priority,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
  };
  // Mongoose materializes the empty specimen subdoc, so check a required
  // leaf field instead of truthiness of the object itself.
  if (order.specimen?.collectedAt && actor?.role !== 'patient') {
    base.specimen = {
      specimenId: order.specimen.specimenId,
      type: order.specimen.type,
      collectedAt: order.specimen.collectedAt.toISOString(),
      custodyCount: order.specimen.custody?.length ?? 0,
    };
  }
  // Billing linkage (AC-34 traceability) — staff views only.
  if (order.chargeId && actor?.role !== 'patient') {
    base.chargeId = String(order.chargeId);
  }
  const patientView = actor?.role === 'patient';
  if (order.results) {
    const released = order.status === 'RELEASED' && order.results.releasedToPatient;
    if (!patientView) {
      base.results = {
        values: order.results.values,
        notes: order.results.notes,
        isCritical: order.results.isCritical,
        verifiedAt: order.results.verifiedAt?.toISOString() ?? null,
        versionCount: order.results.versions.length,
        releasedAt: order.results.releasedAt?.toISOString() ?? null,
      };
    } else if (released) {
      base.results = { values: order.results.values, notes: order.results.notes };
    }
  }
  return base;
}
