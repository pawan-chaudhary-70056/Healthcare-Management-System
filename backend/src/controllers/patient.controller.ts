import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { ok, created, pageMeta } from '../helpers/response.helper.js';
import { parsePagination } from '../helpers/pagination.helper.js';
import * as service from '../services/patient.service.js';
import { actorOf, reqMeta } from '../helpers/actor.helper.js';

/**
 * Patients controller — EP-10…14 (thin HTTP layer; rules live in the service).
 * Object-level checks and denial auditing happen inside the service (R-08/R-09).
 */

/** Strip Mongo internals from a doc/lean object for API output. */
function clean(p: unknown): Record<string, unknown> {
  const plain =
    typeof (p as { toObject?: unknown }).toObject === 'function'
      ? (p as { toObject: () => Record<string, unknown> }).toObject()
      : (p as Record<string, unknown>);
  const { __v, consents, ...rest } = plain;
  void __v;
  void consents;
  return { id: String(plain._id), ...rest };
}

// EP-10 POST /patients — patient.create (admin, receptionist)
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const patient = await service.createPatient(
    req.body,
    actorOf(req),
    reqMeta(req)
  );
  created(res, { id: String(patient._id), mrn: patient.mrn, ...clean(patient) });
});

// EP-11 GET /patients/:id — role projection + object/scope check
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const patient = await service.assertCanAccessPatient(
    req.params.id as string,
    actorOf(req),
    reqMeta(req)
  );
  ok(res, clean(patient));
});

// EP-12 PATCH /patients/:id — patient.update | patient.update.own
export const update: RequestHandler = asyncHandler(async (req, res) => {
  const patient = await service.updatePatient(
    req.params.id as string,
    req.body,
    actorOf(req),
    reqMeta(req)
  );
  ok(res, clean(patient));
});

// EP-13 GET /patients/:id/summary — care-team scope
export const summary: RequestHandler = asyncHandler(async (req, res) => {
  const patient = await service.assertCanAccessPatient(
    req.params.id as string,
    actorOf(req),
    reqMeta(req)
  );
  ok(res, await service.patientSummary(patient));
});

// EP-14 PUT /patients/:id/consents — patient.consent.manage
export const putConsents: RequestHandler = asyncHandler(async (req, res) => {
  const patient = await service.putConsents(
    req.params.id as string,
    req.body.consents,
    actorOf(req),
    reqMeta(req)
  );
  ok(res, { consentFlags: patient.consentFlags });
});

// Staff patient search — patient.create grants the booking lookup (R-06).
export const list: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await service.listPatients(
    { q: req.query.q as string | undefined },
    skip,
    limit,
    actorOf(req)
  );
  ok(res, items.map(clean), 200, pageMeta(page, limit, total));
});
