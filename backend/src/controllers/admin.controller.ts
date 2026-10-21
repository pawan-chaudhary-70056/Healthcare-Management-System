import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created, pageMeta } from '../helpers/response.helper.js';
import { parsePagination } from '../helpers/pagination.helper.js';
import { Department } from '../models/department.model.js';
import * as service from '../services/admin.service.js';

/** Admin controller — EP-70/71/74 + reference data (EP-71a/b). Thin HTTP layer. */

/** Minimum-necessary user projection — never passwordHash or MFA secrets. */
function serializeUser(u: {
  _id: unknown;
  email: string;
  role: string;
  status: string;
  staffProfile?: unknown;
  createdAt?: Date;
}) {
  return {
    id: String(u._id),
    email: u.email,
    role: u.role,
    status: u.status,
    staffProfile: u.staffProfile ?? {},
    createdAt: u.createdAt,
  };
}

// ---- Public directory (EP-08/09, FR-56) -----------------------------------
export const publicDepartments: RequestHandler = asyncHandler(async (_req, res) => {
  const items = await Department.find({ active: true, publicVisible: true })
    .sort({ orderIndex: 1, name: 1 })
    .select('name description orderIndex')
    .lean();
  ok(res, items);
});

export const publicDoctors: RequestHandler = asyncHandler(async (req, res) => {
  const { departmentId } = req.query as { departmentId?: string };
  const doctors = await service.listDoctors(departmentId);
  const { page, limit, skip } = parsePagination(req.query);
  const paged = doctors.slice(skip, skip + limit);
  ok(res, paged, 200, pageMeta(page, limit, doctors.length));
});

// ---- Reference data (EP-71a/71b) ------------------------------------------
export const listDepartments: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  const [items, total] = await Promise.all([
    Department.find(filter).sort({ orderIndex: 1, name: 1 }).skip(skip).limit(limit).lean(),
    Department.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const createDepartment: RequestHandler = asyncHandler(async (req, res) => {
  created(res, await service.createDepartment(req.body, actorOf(req)));
});

export const updateDepartment: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.updateDepartment(req.params.id as string, req.body, actorOf(req)));
});

export const listDoctors: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.listDoctors(req.query.departmentId as string | undefined));
});

export const createDoctor: RequestHandler = asyncHandler(async (req, res) => {
  // Route validation guarantees email/fullName; default role: doctor, with the
  // acting admin's password requirement shared with EP-70 user provisioning.
  const user = await service.createStaffUser(
    { ...req.body, role: 'doctor', password: req.body.password },
    actorOf(req)
  );
  created(res, { id: String(user._id), email: user.email, fullName: user.staffProfile?.fullName });
});

export const listSchedules: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    await service.listDoctorSchedules({
      doctorId: req.query.doctorId as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
    })
  );
});

export const createSchedule: RequestHandler = asyncHandler(async (req, res) => {
  created(res, await service.createDoctorSchedule(req.body, actorOf(req)));
});

export const updateSchedule: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.updateDoctorSchedule(req.params.id as string, req.body, actorOf(req)));
});

export const listScheduleExceptions: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    await service.listScheduleExceptions({
      doctorId: req.query.doctorId as string | undefined,
      date: req.query.date as string | undefined,
    })
  );
});

export const createScheduleException: RequestHandler = asyncHandler(async (req, res) => {
  created(res, await service.createScheduleException(req.body, actorOf(req)));
});

export const deleteScheduleException: RequestHandler = asyncHandler(async (req, res) => {
  await service.deleteScheduleException(req.params.id as string, actorOf(req));
  ok(res, { deleted: true });
});

// ---- User & role management (EP-70/71) ------------------------------------
export const listUsers: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await service.listUsers(
    {
      role: req.query.role as string | undefined,
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
    },
    skip,
    limit
  );
  ok(res, items.map(serializeUser), 200, pageMeta(page, limit, total));
});

export const createUser: RequestHandler = asyncHandler(async (req, res) => {
  const user = await service.createStaffUser(req.body, actorOf(req));
  created(res, serializeUser(user));
});

export const updateUser: RequestHandler = asyncHandler(async (req, res) => {
  const user = await service.updateUser(req.params.id as string, req.body, actorOf(req));
  ok(res, serializeUser(user));
});

export const assignRole: RequestHandler = asyncHandler(async (req, res) => {
  const { user, previousRole } = await service.assignUserRole(
    req.params.id as string,
    req.body,
    actorOf(req)
  );
  ok(res, { ...serializeUser(user), previousRole });
});

// ---- Backups (EP-74) ------------------------------------------------------
export const triggerBackup: RequestHandler = asyncHandler(async (req, res) => {
  created(res, await service.triggerBackup(actorOf(req)));
});
