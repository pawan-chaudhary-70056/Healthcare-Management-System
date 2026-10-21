import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created } from '../helpers/response.helper.js';
import * as service from '../services/lab.service.js';

/** Laboratory controller — EP-40…46 (thin HTTP layer). */

// EP-40 POST /lab/orders — lab.order.create (doctor)
export const createOrder: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.createLabOrder(req.body, actorOf(req), req);
  created(res, service.serializeLabOrder(order));
});

export const listOrders: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listLabOrdersForActor(
    {
      patientId: req.query.patientId as string | undefined,
      status: req.query.status as string | undefined,
    },
    actorOf(req)
  );
  ok(res, items.map((o) => service.serializeLabOrder(o, actorOf(req))));
});

export const getOrder: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.getLabOrderForActor(req.params.id as string, actorOf(req), req);
  ok(res, service.serializeLabOrder(order, actorOf(req)));
});

export const cancelOrder: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.cancelLabOrder(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-41 specimen (PERM-31)
export const recordSpecimen: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.recordSpecimen(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

export const addCustody: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.addCustodyEntry(req.params.id as string, req.body.action, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-42 result entry (PERM-32)
export const enterResults: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.enterResults(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-43 verification (PERM-33)
export const verifyResults: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.verifyResults(req.params.id as string, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-46 critical acknowledgment
export const acknowledgeCritical: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.acknowledgeCritical(req.params.id as string, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-44 release (PERM-34)
export const releaseResults: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.releaseResults(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});

// EP-45 amend (PERM-32)
export const amendResults: RequestHandler = asyncHandler(async (req, res) => {
  const order = await service.amendResults(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeLabOrder(order));
});
