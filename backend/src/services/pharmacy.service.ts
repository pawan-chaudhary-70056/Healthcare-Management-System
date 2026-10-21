import { Types } from 'mongoose';
import {
  Drug,
  DrugBatch,
  InventoryMovement,
  DispenseRecord,
  type DrugBatchDoc,
} from '../models/pharmacy.model.js';
// NOTE: `Drug` is imported above and used inside the transaction; do not shadow it.
import {
  Prescription,
  type PrescriptionDoc,
} from '../models/clinical.model.js';
import { AppError } from '../errors/app-error.js';
import { audit } from './audit.service.js';
import { withTransaction } from '../helpers/transaction.helper.js';
import { escapeRegex } from '../utils/regex.js';
import { enqueue } from './notification.service.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Pharmacy service — PH-06 (EP-50…55, FR-33…42, AC-35…42).
 * The validation gauntlet (§1) runs BEFORE any stock moves; the dispense is
 * ONE transaction: batch deduction (FEFO, never below zero) + dispense record
 * + prescription status update + billing charge (AC-36, Database Design §6).
 * Object-level access is permission-gated (no `*.own` read paths exist here),
 * so the SEC-08 denial-audit helper is not needed in this module.
 */

// ---------------------------------------------------------------------------
// Inventory: receipts (EP-52), adjustments (EP-54), quarantine/recall (EP-55)
// ---------------------------------------------------------------------------

export async function receiveStock(
  input: { drugCode: string; batchNo: string; expiryDate: string; quantity: number },
  actor: Actor,
  req?: ReqMeta
): Promise<{ batch: DrugBatchDoc }> {
  if (actor.role !== 'pharmacist') {
    throw new AppError('FORBIDDEN', 'Only pharmacists can receive stock.');
  }
  if (input.quantity <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Quantity must be positive.', [
      { field: 'quantity', issue: 'must be > 0' },
    ]);
  }
  const expiry = new Date(input.expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'expiryDate must be a valid date.', [
      { field: 'expiryDate', issue: 'invalid date' },
    ]);
  }
  const drug = await Drug.findOne({ code: input.drugCode, active: true });
  if (!drug) {
    throw new AppError('VALIDATION_ERROR', 'Unknown or inactive drug code.', [
      { field: 'drugCode', issue: 'must be an active catalog code' },
    ]);
  }

  const status: DrugBatchDoc['status'] = expiry.getTime() < Date.now() ? 'EXPIRED' : 'AVAILABLE';
  const created = await DrugBatch.create([
    {
      drugId: drug._id,
      batchNo: input.batchNo,
      expiryDate: expiry,
      quantity: input.quantity,
      initialQuantity: input.quantity,
      status,
      receivedBy: actor.id,
    },
  ]);
  const batch = created[0]!;

  await InventoryMovement.create({
    drugId: drug._id,
    batchId: batch._id,
    type: 'RECEIVE',
    delta: input.quantity,
    by: actor.id,
    refType: 'batch',
    refId: String(batch._id),
  });

  await audit({
    action: AUDIT_ACTIONS.INVENTORY_RECEIVE,
    module: 'pharmacy',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'drug_batch',
    resourceId: String(batch._id),
    req,
    details: { drugCode: input.drugCode, batchNo: input.batchNo, quantity: input.quantity },
  });
  return { batch };
}

/** Authorized adjustment with mandatory reason (PERM-44, audited — AC-41). */
export async function adjustStock(
  batchId: string,
  input: { delta: number; reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<DrugBatchDoc> {
  if (actor.role !== 'pharmacist') {
    throw new AppError('FORBIDDEN', 'Only pharmacists can adjust stock.');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'An adjustment reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  const batch = await DrugBatch.findById(batchId);
  if (!batch) throw new AppError('NOT_FOUND', 'Batch not found.');
  const next = batch.quantity + input.delta;
  if (next < 0) {
    throw new AppError('INSUFFICIENT_STOCK', 'Adjustment would drive stock below zero.');
  }
  batch.quantity = next;
  await batch.save();

  await InventoryMovement.create({
    drugId: batch.drugId,
    batchId: batch._id,
    type: 'ADJUST',
    delta: input.delta,
    reason: input.reason.trim(),
    by: actor.id,
  });
  await audit({
    action: AUDIT_ACTIONS.INVENTORY_ADJUST,
    module: 'pharmacy',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'drug_batch',
    resourceId: batchId,
    req,
    details: { delta: input.delta, reason: input.reason.trim(), resultingQty: next },
  });
  return batch;
}

export async function setBatchStatus(
  batchId: string,
  status: 'QUARANTINED' | 'RECALLED',
  reason: string,
  actor: Actor,
  req?: ReqMeta
): Promise<DrugBatchDoc> {
  if (actor.role !== 'pharmacist') {
    throw new AppError('FORBIDDEN', 'Only pharmacists can quarantine or recall batches.');
  }
  const batch = await DrugBatch.findById(batchId);
  if (!batch) throw new AppError('NOT_FOUND', 'Batch not found.');
  batch.status = status;
  await batch.save();

  await InventoryMovement.create({
    drugId: batch.drugId,
    batchId: batch._id,
    type: status === 'QUARANTINED' ? 'QUARANTINE' : 'RECALL',
    delta: 0,
    reason: reason,
    by: actor.id,
  });
  await audit({
    action: status === 'QUARANTINED' ? AUDIT_ACTIONS.BATCH_QUARANTINE : AUDIT_ACTIONS.BATCH_RECALL,
    module: 'pharmacy',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'drug_batch',
    resourceId: batchId,
    req,
    details: { reason },
  });
  return batch;
}

/** Expiry sweep (job, EP-55): auto-quarantine expired batches. Idempotent. */
export async function sweepExpiredBatches(now: Date = new Date()): Promise<number> {
  const expired = await DrugBatch.find({
    status: 'AVAILABLE',
    expiryDate: { $lt: now },
  }).limit(500);
  let swept = 0;
  for (const batch of expired) {
    batch.status = 'EXPIRED';
    await batch.save();
    await InventoryMovement.create({
      drugId: batch.drugId,
      batchId: batch._id,
      type: 'EXPIRE',
      delta: 0,
      by: 'system',
      reason: 'Expiry sweep',
    });
    swept += 1;
  }
  return swept;
}

/** Daily prescription EXPIRED sweep (EP-55, Glossary §13.4). */
export async function sweepExpiredPrescriptions(now: Date = new Date()): Promise<number> {
  const result = await Prescription.updateMany(
    { status: 'ACTIVE', expiresAt: { $lt: now } },
    { $set: { status: 'EXPIRED' } }
  );
  return result.modifiedCount ?? 0;
}

// ---------------------------------------------------------------------------
// EP-50 — validation queue: prescriptions awaiting validation/dispense
// ---------------------------------------------------------------------------

export async function validationQueue(actor: Actor): Promise<PrescriptionDoc[]> {
  if (actor.role !== 'pharmacist') {
    throw new AppError('FORBIDDEN', 'Only pharmacists can view the validation queue.');
  }
  const items = await Prescription.find({ status: 'ACTIVE' })
    .sort({ createdAt: 1 })
    .limit(100)
    .populate('patientId', 'mrn firstName lastName');
  return items as unknown as PrescriptionDoc[];
}

/**
 * EP-51 — dispense transaction (AC-35/36/37/38/40).
 * Validation gauntlet inside the tx; FEFO picks batches; deducts never go
 * below zero; dispense record + prescription status + charge in ONE commit.
 */
export async function dispensePrescription(
  prescriptionId: string,
  actor: Actor,
  req?: ReqMeta
): Promise<{ dispenseId: string; status: string; lines: Array<{ medicine: string; batchNo: string; quantity: number }> }> {
  if (actor.role !== 'pharmacist') {
    throw new AppError('FORBIDDEN', 'Only pharmacists can dispense.');
  }

  return withTransaction(async (session) => {
    const rx = await Prescription.findById(prescriptionId).session(session);
    if (!rx) throw new AppError('NOT_FOUND', 'Prescription not found.');

    // --- Validation gauntlet (§1, AC-35) — all checks must pass together ---
    if (rx.status === 'CANCELLED') {
      throw new AppError('PRESCRIPTION_INVALID', 'This prescription was cancelled by the prescriber.');
    }
    if (rx.status === 'EXPIRED' || rx.expiresAt.getTime() < Date.now()) {
      throw new AppError('PRESCRIPTION_INVALID', 'This prescription has expired.');
    }
    if (!['ACTIVE', 'PARTIALLY_DISPENSED'].includes(rx.status)) {
      throw new AppError('PRESCRIPTION_INVALID', `Prescription is ${rx.status} and cannot be dispensed.`);
    }
    // Duplicate dispensing check: nothing left to dispense.
    const remaining = rx.items.map((q, i) => q.quantity - (rx.dispensedQty[i] ?? 0));
    if (remaining.every((r) => r <= 0)) {
      throw new AppError('PRESCRIPTION_INVALID', 'This prescription is already fully dispensed.');
    }

    // --- FEFO batch pick per item (AC-37/AC-40: expired/quarantined blocked) ---
    const dispenseLines: Array<{ itemIndex: number; batchId: Types.ObjectId; quantity: number; drugId: Types.ObjectId }> = [];
    for (let i = 0; i < rx.items.length; i += 1) {
      const need = remaining[i]!;
      if (need <= 0) continue;
      const item = rx.items[i]!;
      const drug = await Drug.findOne({
        $or: [{ name: item.medicine }, { name: { $regex: `^${escapeRegex(item.medicine.split(' ')[0]!)}`, $options: 'i' } }],
        active: true,
      }).session(session);
      if (!drug) {
        throw new AppError('INSUFFICIENT_STOCK', `No catalog drug matches '${item.medicine}'.`);
      }
      // FEFO: earliest expiry first; only AVAILABLE batches with stock.
      const batches = await DrugBatch.find({
        drugId: drug._id,
        status: 'AVAILABLE',
        expiryDate: { $gt: new Date() }, // expired blocked (AC-37)
        quantity: { $gt: 0 },
      })
        .sort({ expiryDate: 1 })
        .session(session);

      let left = need;
      for (const batch of batches) {
        if (left <= 0) break;
        const take = Math.min(batch.quantity, left);
        dispenseLines.push({ itemIndex: i, batchId: batch._id, quantity: take, drugId: batch.drugId });
        left -= take;
      }
      if (left > 0) {
        throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock for ${item.medicine} (short ${left} units).`);
      }
    }

    // --- Atomic deduction: never below zero (AC-38) ---
    // Re-read each batch with the session and apply a guarded update; if a
    // concurrent dispense already drained the batch the guarded update matches
    // nothing and the tx aborts (no negative stock, no duplicate deduction).
    const batchDeductions = new Map<string, number>();
    for (const line of dispenseLines) {
      batchDeductions.set(String(line.batchId), (batchDeductions.get(String(line.batchId)) ?? 0) + line.quantity);
    }
    for (const [batchIdStr, qty] of batchDeductions) {
      const res = await DrugBatch.updateOne(
        { _id: new Types.ObjectId(batchIdStr), quantity: { $gte: qty }, status: 'AVAILABLE' },
        { $inc: { quantity: -qty } },
        { session }
      );
      if (res.modifiedCount !== 1) {
        throw new AppError('INSUFFICIENT_STOCK', 'Stock changed concurrently — retry dispense.');
      }
    }

    // --- Dispense record ---
    const recordCreated = await DispenseRecord.create(
      [
        {
          prescriptionId: rx._id,
          patientId: rx.patientId,
          pharmacistId: actor.id,
          lines: dispenseLines.map((l) => ({ itemIndex: l.itemIndex, batchId: l.batchId, quantity: l.quantity })),
        },
      ],
      { session }
    );
    const record = recordCreated[0]!;

    // --- Prescription status update (PARTIALLY/FULLY, §2) ---
    for (const line of dispenseLines) {
      rx.dispensedQty[line.itemIndex] = (rx.dispensedQty[line.itemIndex] ?? 0) + line.quantity;
    }
    const fully = rx.items.every((q, i) => (rx.dispensedQty[i] ?? 0) >= q.quantity);
    rx.status = fully ? 'FULLY_DISPENSED' : 'PARTIALLY_DISPENSED';
    await rx.save({ session });

    // --- Billing charge (patient + encounter, AC-36 fan-out) ---
    // Price = catalog unit price × units dispensed, integer minor units (C-02).
    const { Charge } = await import('../models/billing.model.js');
    const drugIds = [...new Set(dispenseLines.map((l) => String(l.drugId)))];
    const drugDocs = await Drug.find({ _id: { $in: drugIds.map((d) => new Types.ObjectId(d)) } }).session(session);
    const priceOf = new Map(drugDocs.map((d) => [String(d._id), d.unitPriceMinor]));
    let totalMinor = 0;
    for (const line of dispenseLines) {
      totalMinor += line.quantity * (priceOf.get(String(line.drugId)) ?? 0);
    }
    const charge = await Charge.create(
      [
        {
          patientId: rx.patientId,
          encounterId: rx.encounterId,
          sourceType: 'PHARMACY',
          sourceId: rx._id,
          description: `Pharmacy dispense (${dispenseLines.length} line${dispenseLines.length === 1 ? '' : 's'})`,
          amountMinor: totalMinor,
          quantity: 1,
        },
      ],
      { session }
    );
    record.chargeId = charge[0]!._id;
    await record.save({ session });

    // --- Movements + audit ---
    for (const [batchIdStr, qty] of batchDeductions) {
      await InventoryMovement.create(
        [
          {
            drugId: (await DrugBatch.findById(batchIdStr).session(session))!.drugId,
            batchId: new Types.ObjectId(batchIdStr),
            type: 'DISPENSE',
            delta: -qty,
            by: actor.id,
            refType: 'dispense_record',
            refId: String(record._id),
          },
        ],
        { session }
      );
    }

    await audit({
      action: AUDIT_ACTIONS.PRESCRIPTION_DISPENSE,
      module: 'pharmacy',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'prescription',
      resourceId: String(rx._id),
      patientId: String(rx.patientId),
      req,
      details: { dispenseId: String(record._id), status: rx.status, lines: dispenseLines.length },
    });

    // Notify patient that medicine is ready (privacy-trimmed: no clinical detail).
    const patient = await (await import('../models/patient.model.js')).Patient
      .findById(rx.patientId)
      .select('userId')
      .session(session);
    if (patient?.userId) {
      await enqueue(
        { userId: String(patient.userId), event: 'pharmacy.ready', payload: { prescriptionId: String(rx._id) } },
        session
      );
    }

    return {
      dispenseId: String(record._id),
      status: rx.status,
      lines: dispenseLines.map((l) => ({
        medicine: rx.items[l.itemIndex]!.medicine,
        batchNo: String(l.batchId),
        quantity: l.quantity,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Inventory reads
// ---------------------------------------------------------------------------

export async function listBatches(actor: Actor, drugCode?: string): Promise<DrugBatchDoc[]> {
  if (actor.role !== 'pharmacist' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only pharmacy staff can view inventory.');
  }
  const query: Record<string, unknown> = {};
  if (drugCode) {
    const drug = await Drug.findOne({ code: drugCode });
    if (drug) query.drugId = drug._id;
  }
  return DrugBatch.find(query).sort({ expiryDate: 1 }).limit(300);
}

export async function listMovements(actor: Actor, drugCode?: string): Promise<unknown[]> {
  if (actor.role !== 'pharmacist' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only pharmacy staff can view movements.');
  }
  const query: Record<string, unknown> = {};
  if (drugCode) {
    const drug = await Drug.findOne({ code: drugCode });
    if (drug) query.drugId = drug._id;
  }
  return InventoryMovement.find(query).sort({ createdAt: -1 }).limit(300).populate('drugId', 'name code');
}

/** Reorder view: total available stock per drug vs reorder level. */
export async function reorderReport(actor: Actor): Promise<Array<{ code: string; name: string; available: number; reorderLevel: number }>> {
  if (actor.role !== 'pharmacist' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only pharmacy staff can view reorder reports.');
  }
  const drugs = await Drug.find({ active: true }).limit(500);
  const out: Array<{ code: string; name: string; available: number; reorderLevel: number }> = [];
  for (const drug of drugs) {
    const batches = await DrugBatch.find({ drugId: drug._id, status: 'AVAILABLE' });
    const available = batches.reduce((sum, b) => sum + b.quantity, 0);
    if (available <= drug.reorderLevel) {
      out.push({ code: drug.code, name: drug.name, available, reorderLevel: drug.reorderLevel });
    }
  }
  return out;
}
