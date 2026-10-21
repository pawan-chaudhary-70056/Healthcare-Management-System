import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created } from '../helpers/response.helper.js';
import * as service from '../services/clinical.service.js';

/** Clinical & nursing controller — EP-30…38 (thin HTTP layer). */

// EP-30 POST /encounters — encounter.create (doctor)
export const createEncounter: RequestHandler = asyncHandler(async (req, res) => {
  const encounter = await service.createEncounter(req.body, actorOf(req), req);
  created(res, service.serializeEncounter(encounter));
});

export const listOpenEncounters: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    (await service.listOpenEncounters(actorOf(req))).map(service.serializeEncounter)
  );
});

export const getEncounter: RequestHandler = asyncHandler(async (req, res) => {
  const enc = await service.getEncounterForActor(req.params.id as string, actorOf(req), req);
  ok(res, service.serializeEncounter(enc));
});

export const finalizeEncounter: RequestHandler = asyncHandler(async (req, res) => {
  const { encounter, appointment } = await service.finalizeEncounter(
    req.params.id as string,
    actorOf(req),
    req
  );
  ok(res, { encounter: service.serializeEncounter(encounter), appointmentStatus: appointment.status });
});

// EMR entries (EP-31…34)
export const writeEmr: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await service.writeEmrEntry(req.params.id as string, req.body, actorOf(req), req);
  created(res, service.serializeEmrEntry(entry));
});

export const listEmr: RequestHandler = asyncHandler(async (req, res) => {
  const entries = await service.listEmrForEncounter(req.params.id as string, actorOf(req), req);
  ok(res, entries.map((e) => service.serializeEmrEntry(e, actorOf(req))));
});

export const finalizeEmr: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await service.finalizeEmrEntry(req.params.entryId as string, actorOf(req), req);
  ok(res, service.serializeEmrEntry(entry));
});

export const amendEmr: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await service.amendEmrEntry(req.params.entryId as string, req.body, actorOf(req), req);
  ok(res, service.serializeEmrEntry(entry));
});

export const emrVersions: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.getEmrVersions(req.params.entryId as string, actorOf(req), req));
});

export const releaseEmr: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await service.releaseEmrToPatient(req.params.entryId as string, actorOf(req), req);
  ok(res, service.serializeEmrEntry(entry));
});

// Prescriptions (EP-35/36)
export const createPrescription: RequestHandler = asyncHandler(async (req, res) => {
  const rx = await service.createPrescription(req.body, actorOf(req), req);
  created(res, service.serializePrescription(rx));
});

export const listPrescriptions: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listPrescriptionsForActor(
    {
      patientId: req.query.patientId as string | undefined,
      status: req.query.status as string | undefined,
    },
    actorOf(req)
  );
  ok(res, items.map(service.serializePrescription));
});

export const cancelPrescription: RequestHandler = asyncHandler(async (req, res) => {
  const rx = await service.cancelPrescription(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializePrescription(rx));
});

// Nursing entries (EP-37/38)
export const createNursingEntry: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await service.createNursingEntry(req.body, actorOf(req), req);
  created(res, service.serializeNursingEntry(entry));
});

export const listNursingEntries: RequestHandler = asyncHandler(async (req, res) => {
  const patientId = req.query.patientId as string | undefined;
  if (!patientId) {
    ok(res, []);
    return;
  }
  const entries = await service.listNursingEntries(patientId, actorOf(req), req);
  ok(res, entries.map(service.serializeNursingEntry));
});
