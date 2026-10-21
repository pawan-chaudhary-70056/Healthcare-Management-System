import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created } from '../helpers/response.helper.js';
import * as service from '../services/pharmacy.service.js';
import { Drug } from '../models/pharmacy.model.js';

/** Pharmacy controller — EP-50…55 (thin HTTP layer). */

// EP-50 GET /pharmacy/queue — prescription.validate (pharmacist)
export const validationQueue: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.validationQueue(actorOf(req));
  ok(
    res,
    items.map((rx) => ({
      id: String(rx._id),
      patientId: String(rx.patientId),
      doctorId: String(rx.doctorId),
      items: rx.items,
      status: rx.status,
      expiresAt: rx.expiresAt.toISOString(),
      createdAt: rx.createdAt.toISOString(),
    }))
  );
});

// EP-51 POST /pharmacy/dispense/:prescriptionId — prescription.dispense
export const dispense: RequestHandler = asyncHandler(async (req, res) => {
  const result = await service.dispensePrescription(
    req.params.prescriptionId as string,
    actorOf(req),
    req
  );
  ok(res, result);
});

// EP-52 POST /pharmacy/inventory/receive — pharmacy.inventory.manage
export const receiveStock: RequestHandler = asyncHandler(async (req, res) => {
  const { batch } = await service.receiveStock(req.body, actorOf(req), req);
  created(res, {
    id: String(batch._id),
    drugId: String(batch.drugId),
    batchNo: batch.batchNo,
    quantity: batch.quantity,
    expiryDate: batch.expiryDate.toISOString(),
    status: batch.status,
  });
});

// EP-53 GET /pharmacy/inventory/batches
export const listBatches: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listBatches(
    actorOf(req),
    req.query.drugCode as string | undefined
  );
  ok(
    res,
    items.map((b) => ({
      id: String(b._id),
      drugId: String(b.drugId),
      batchNo: b.batchNo,
      quantity: b.quantity,
      initialQuantity: b.initialQuantity,
      expiryDate: b.expiryDate.toISOString(),
      status: b.status,
    }))
  );
});

// EP-53 GET /pharmacy/inventory/movements — append-only trail
export const listMovements: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    await service.listMovements(actorOf(req), req.query.drugCode as string | undefined)
  );
});

// EP-54 POST /pharmacy/inventory/batches/:id/adjust — pharmacy.stock.adjust (audited)
export const adjustStock: RequestHandler = asyncHandler(async (req, res) => {
  const batch = await service.adjustStock(req.params.id as string, req.body, actorOf(req), req);
  ok(res, { id: String(batch._id), quantity: batch.quantity, status: batch.status });
});

// EP-55 POST /pharmacy/inventory/batches/:id/quarantine
export const quarantineBatch: RequestHandler = asyncHandler(async (req, res) => {
  const batch = await service.setBatchStatus(
    req.params.id as string,
    'QUARANTINED',
    req.body.reason,
    actorOf(req),
    req
  );
  ok(res, { id: String(batch._id), status: batch.status });
});

// EP-55 POST /pharmacy/inventory/batches/:id/recall
export const recallBatch: RequestHandler = asyncHandler(async (req, res) => {
  const batch = await service.setBatchStatus(
    req.params.id as string,
    'RECALLED',
    req.body.reason,
    actorOf(req),
    req
  );
  ok(res, { id: String(batch._id), status: batch.status });
});

// GET /pharmacy/reorder — reorder report
export const reorder: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.reorderReport(actorOf(req)));
});

// GET /pharmacy/drugs — catalog lookup (used by validation UI)
export const drugs: RequestHandler = asyncHandler(async (_req, res) => {
  const list = await Drug.find({ active: true }).limit(500);
  ok(
    res,
    list.map((d) => ({
      id: String(d._id),
      code: d.code,
      name: d.name,
      form: d.form,
      strength: d.strength,
      reorderLevel: d.reorderLevel,
    }))
  );
});
