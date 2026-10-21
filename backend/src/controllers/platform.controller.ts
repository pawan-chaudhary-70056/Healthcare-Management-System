import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok } from '../helpers/response.helper.js';
import { parsePagination } from '../helpers/pagination.helper.js';
import * as service from '../services/platform.service.js';

/**
 * Platform controller — PH-08 (EP-72/73/76/77) + in-app notifications.
 * Thin handlers only; scope/role rules live in the service.
 */

// Notifications — in-app bell (any authenticated user sees their own)
export const notifications: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await service.listNotificationsForUser(
    actorOf(req),
    skip,
    limit
  );
  ok(res, items, 200, { page, limit, total });
});

// Settings / policy engine (EP-72)
export const getPolicy: RequestHandler = asyncHandler(async (_req, res) => {
  ok(res, await service.getPolicySettings());
});

export const setPolicy: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    await service.setPolicySetting(req.params.key as string, req.body.value, actorOf(req), req)
  );
});

// Audit viewer (EP-73) — doctors restricted to own events (PERM-64)
export const auditLog: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const actorIdFilter =
    req.user!.role === 'admin' ? (req.query.actorId as string | undefined) : req.user!.id;
  const result = await service.queryAuditLog(
    {
      action: req.query.action as string | undefined,
      module: req.query.module as string | undefined,
      actorId: actorIdFilter,
      patientId: req.query.patientId as string | undefined,
    },
    skip,
    limit
  );
  ok(res, result.items, 200, { page, limit, total: result.total });
});

// Break-glass (EP-76/77)
export const requestBreakGlass: RequestHandler = asyncHandler(async (req, res) => {
  const bg = await service.requestBreakGlass(req.body, actorOf(req), req);
  ok(res, {
    id: String(bg._id),
    status: bg.status,
    expiresAt: bg.expiresAt.toISOString(),
  });
});

export const revokeBreakGlass: RequestHandler = asyncHandler(async (req, res) => {
  const bg = await service.revokeBreakGlass(req.params.id as string, actorOf(req), req);
  ok(res, { id: String(bg._id), status: bg.status });
});

export const reviewBreakGlass: RequestHandler = asyncHandler(async (req, res) => {
  const bg = await service.reviewBreakGlass(req.params.id as string, req.body, actorOf(req), req);
  ok(res, { id: String(bg._id), status: bg.status });
});

export const listBreakGlass: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listBreakGlass(actorOf(req));
  ok(
    res,
    items.map((bg) => ({
      id: String(bg._id),
      requesterId: bg.requesterId,
      requesterRole: bg.requesterRole,
      patientId: String(bg.patientId),
      reason: bg.reason,
      status: bg.status,
      expiresAt: bg.expiresAt.toISOString(),
      reviewedAt: bg.reviewedAt?.toISOString() ?? null,
    }))
  );
});
