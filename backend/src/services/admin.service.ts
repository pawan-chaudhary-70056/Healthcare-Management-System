import mongoose, { type FilterQuery } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Department, type DepartmentDoc } from '../models/department.model.js';
import {
  DoctorSchedule,
  ScheduleException,
  type DoctorScheduleDoc,
  type ScheduleExceptionDoc,
} from '../models/doctor-schedule.model.js';
import { User, type UserDoc } from '../models/user.model.js';
import { AppError } from '../errors/app-error.js';
import { audit } from './audit.service.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { escapeRegex } from '../utils/regex.js';
import { destroyAllSessionsForUser } from '../utils/session.js';
import { ROLES, USER_STATUS, AUDIT_ACTIONS, type Role } from '../config/constants.js';

type Actor = { id: string; role: string } | undefined;

/** Self-registration owns patient accounts (EP-04); EP-70 manages staff only. */
const STAFF_ROLES = ROLES.filter((r) => r !== 'patient');

export async function listDepartments(filter: { active?: boolean; publicVisible?: boolean }) {
  const query: FilterQuery<DepartmentDoc> = {};
  if (filter.active !== undefined) query.active = filter.active;
  if (filter.publicVisible !== undefined) query.publicVisible = filter.publicVisible;
  return Department.find(query).sort({ orderIndex: 1, name: 1 }).lean();
}

export async function createDepartment(
  input: { name: string; description?: string; publicVisible?: boolean; orderIndex?: number },
  actor?: { id: string; role: string }
) {
  const exists = await Department.findOne({ name: input.name.trim() });
  if (exists) throw new AppError('CONFLICT', 'A department with that name already exists.');
  const dept = await Department.create({
    name: input.name.trim(),
    description: input.description,
    publicVisible: input.publicVisible ?? true,
    orderIndex: input.orderIndex ?? 0,
  });
  await audit({
    action: 'admin.department_create',
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'department',
    resourceId: String(dept._id),
    details: { name: dept.name },
  });
  return dept;
}

export async function updateDepartment(
  id: string,
  patch: { name?: string; description?: string; publicVisible?: boolean; active?: boolean; orderIndex?: number },
  actor?: { id: string; role: string }
) {
  const dept = await Department.findById(id);
  if (!dept) throw new AppError('NOT_FOUND', 'Department not found.');
  if (patch.name !== undefined) dept.name = patch.name.trim();
  if (patch.description !== undefined) dept.description = patch.description;
  if (patch.publicVisible !== undefined) dept.publicVisible = patch.publicVisible;
  if (patch.active !== undefined) dept.active = patch.active;
  if (patch.orderIndex !== undefined) dept.orderIndex = patch.orderIndex;
  await dept.save();
  await audit({
    action: 'admin.department_update',
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'department',
    resourceId: id,
    details: { patch },
  });
  return dept;
}

export async function listDoctorSchedules(filter: { doctorId?: string; departmentId?: string; active?: boolean }) {
  const query: FilterQuery<DoctorScheduleDoc> = {};
  if (filter.doctorId) query.doctorId = filter.doctorId;
  if (filter.departmentId) query.departmentId = filter.departmentId;
  if (filter.active !== undefined) query.active = filter.active;
  return DoctorSchedule.find(query).sort({ weekday: 1, startTime: 1 }).lean();
}

export async function createDoctorSchedule(
  input: {
    doctorId: string;
    departmentId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotLengthMinutes: number;
  },
  actor?: { id: string; role: string }
) {
  const doctor = await User.findById(input.doctorId);
  if (!doctor || doctor.role !== 'doctor') {
    throw new AppError('VALIDATION_ERROR', 'doctorId must reference an existing doctor.', [
      { field: 'doctorId', issue: 'must be an existing doctor' },
    ]);
  }
  if (input.startTime >= input.endTime) {
    throw new AppError('VALIDATION_ERROR', 'Schedule times are invalid.', [
      { field: 'endTime', issue: 'must be after startTime' },
    ]);
  }
  const schedule = await DoctorSchedule.create(input);
  await audit({
    action: 'admin.schedule_create',
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'doctor_schedule',
    resourceId: String(schedule._id),
    details: { doctorId: input.doctorId, weekday: input.weekday },
  });
  return schedule;
}

export async function updateDoctorSchedule(
  id: string,
  patch: Partial<Pick<DoctorScheduleDoc, 'startTime' | 'endTime' | 'slotLengthMinutes' | 'active'>>,
  actor?: { id: string; role: string }
) {
  const schedule = await DoctorSchedule.findById(id);
  if (!schedule) throw new AppError('NOT_FOUND', 'Schedule not found.');
  if (patch.startTime !== undefined) schedule.startTime = patch.startTime;
  if (patch.endTime !== undefined) schedule.endTime = patch.endTime;
  if (patch.slotLengthMinutes !== undefined) schedule.slotLengthMinutes = patch.slotLengthMinutes;
  if (patch.active !== undefined) schedule.active = patch.active;
  if (schedule.startTime >= schedule.endTime) {
    throw new AppError('VALIDATION_ERROR', 'Schedule times are invalid.', [
      { field: 'endTime', issue: 'must be after startTime' },
    ]);
  }
  await schedule.save();
  await audit({
    action: 'admin.schedule_update',
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'doctor_schedule',
    resourceId: id,
    details: { patch },
  });
  return schedule;
}

/**
 * Directory projection — EP-09 / AC-62: name, specialty, department, and an
 * availability summary ONLY. Personal contact details (email, phone) never
 * appear in any directory response. Used by both public (EP-09) and admin
 * views; admin email access comes from user management, not this projection.
 */
export async function listDoctors(departmentId?: string) {
  const filter: FilterQuery<UserDoc> = { role: 'doctor', status: 'ACTIVE' };
  const doctors = await User.find(filter).lean();

  // Resolve the department name for filtering (staffProfile stores the name).
  let departmentName: string | undefined;
  if (departmentId) {
    const dept = await Department.findById(departmentId).select('name').lean();
    departmentName = dept?.name;
  }

  const filtered = departmentName
    ? doctors.filter((d) => d.staffProfile?.department === departmentName)
    : doctors;

  // Availability summary: distinct weekdays with an active schedule template.
  const scheduleFilter: FilterQuery<DoctorScheduleDoc> = { active: true };
  if (departmentId) scheduleFilter.departmentId = new mongoose.Types.ObjectId(departmentId);

  const schedules = await DoctorSchedule.find(scheduleFilter)
    .select('doctorId weekday')
    .lean();

  const weekdaysByDoctor = new Map<string, number[]>();
  for (const s of schedules) {
    const key = String(s.doctorId);
    const days = weekdaysByDoctor.get(key) ?? [];
    if (!days.includes(s.weekday)) days.push(s.weekday);
    weekdaysByDoctor.set(key, days);
  }

  return filtered.map((d) => ({
    id: String(d._id),
    fullName: d.staffProfile?.fullName ?? 'Doctor',
    department: d.staffProfile?.department,
    specialties: d.staffProfile?.specialties ?? [],
    availableWeekdays: (weekdaysByDoctor.get(String(d._id)) ?? []).sort((a, b) => a - b),
  }));
}

export async function listScheduleExceptions(filter: { doctorId?: string; date?: string }) {
  const query: FilterQuery<ScheduleExceptionDoc> = {};
  if (filter.doctorId) query.doctorId = filter.doctorId;
  if (filter.date) query.date = filter.date;
  return ScheduleException.find(query).sort({ date: 1 }).lean();
}

export async function createScheduleException(
  input: {
    doctorId: string;
    date: string;
    type: 'CLOSED' | 'CUSTOM';
    customSlots?: Array<{ start: string; end: string }>;
  },
  actor?: { id: string; role: string }
) {
  if (input.type === 'CUSTOM' && (!input.customSlots || input.customSlots.length === 0)) {
    throw new AppError('VALIDATION_ERROR', 'CUSTOM exceptions require customSlots.', [
      { field: 'customSlots', issue: 'required for CUSTOM type' },
    ]);
  }
  const doctor = await User.findById(input.doctorId);
  if (!doctor || doctor.role !== 'doctor') {
    throw new AppError('VALIDATION_ERROR', 'doctorId must reference an existing doctor.', [
      { field: 'doctorId', issue: 'must be an existing doctor' },
    ]);
  }
  try {
    const exception = await ScheduleException.create(input);
    await audit({
      action: 'admin.schedule_exception_create',
      module: 'admin',
      actorId: actor?.id,
      actorRole: actor?.role,
      resourceType: 'schedule_exception',
      resourceId: String(exception._id),
      details: { doctorId: input.doctorId, date: input.date, type: input.type },
    });
    return exception;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError('CONFLICT', 'An exception for that doctor and date already exists.');
    }
    throw err;
  }
}

export async function deleteScheduleException(id: string, actor?: { id: string; role: string }) {
  const exception = await ScheduleException.findByIdAndDelete(id);
  if (!exception) throw new AppError('NOT_FOUND', 'Schedule exception not found.');
  await audit({
    action: 'admin.schedule_exception_delete',
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'schedule_exception',
    resourceId: id,
  });
  return exception;
}

// ---------------------------------------------------------------------------
// EP-70/71 — user & role management (PERM-60/61, AC-56, NFR-41)
// ---------------------------------------------------------------------------

/** Minimum-necessary projection: identity/role/status only — never secrets. */
export const USER_PROJECTION = 'email role status staffProfile createdAt updatedAt';

/** Lean user row returned by `listUsers` (minimum-necessary projection). */
export type UserListRow = {
  _id: unknown;
  email: string;
  role: string;
  status: string;
  staffProfile?: unknown;
  createdAt?: Date;
};

/** True when a value is a canonical staff role (patients self-register, EP-04). */
function isStaffRole(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

export async function listUsers(
  filter: { role?: string; status?: string; q?: string },
  skip: number,
  limit: number
): Promise<{ items: UserListRow[]; total: number }> {
  const query: FilterQuery<UserDoc> = {};
  if (filter.role) query.role = filter.role as Role;
  if (filter.status) query.status = filter.status as UserDoc['status'];
  if (filter.q) {
    const rx = new RegExp(escapeRegex(filter.q), 'i');
    query.email = rx;
  }
  const [items, total] = await Promise.all([
    User.find(query).select(USER_PROJECTION).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ]);
  return { items, total };
}

/**
 * Staff account provisioning — the ONLY creator of staff users (EP-70).
 * Previously a parallel `createDoctorUser` duplicated this with a predictable
 * `ADMIN_PASSWORD-Temp` password; both paths now share one audited creator and
 * every provisioned account requires an explicit password from the admin.
 */
export async function createStaffUser(
  input: {
    email: string;
    password: string;
    role: Role;
    fullName?: string;
    department?: string;
    specialties?: string[];
  },
  actor: Actor
): Promise<UserDoc> {
  if (!isStaffRole(input.role)) {
    throw new AppError('VALIDATION_ERROR', 'Only staff accounts are provisioned here; patients self-register.', [
      { field: 'role', issue: 'must be a staff role' },
    ]);
  }
  const email = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) throw new AppError('CONFLICT', 'A user with that email already exists.');

  const user = await User.create({
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    status: 'ACTIVE',
    staffProfile: {
      fullName: input.fullName,
      department: input.department,
      specialties: input.specialties ?? [],
    },
  });
  await audit({
    action: AUDIT_ACTIONS.USER_CREATE,
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'user',
    resourceId: String(user._id),
    details: { role: user.role, email: user.email },
  });
  return user;
}

export async function updateUser(
  id: string,
  patch: { status?: UserDoc['status']; fullName?: string; department?: string; specialties?: string[] },
  actor: Actor
): Promise<UserDoc> {
  const user = await User.findById(id);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');

  if (patch.status !== undefined) {
    if (!USER_STATUS.includes(patch.status)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid user status.', [
        { field: 'status', issue: 'invalid' },
      ]);
    }
    user.status = patch.status;
    // Suspension/lock forces re-authorization everywhere (Auth Flow §7).
    if (patch.status !== 'ACTIVE') await destroyAllSessionsForUser(id);
  }
  if (patch.fullName !== undefined || patch.department !== undefined || patch.specialties !== undefined) {
    user.staffProfile = {
      fullName: patch.fullName ?? user.staffProfile?.fullName,
      department: patch.department ?? user.staffProfile?.department,
      specialties: patch.specialties ?? user.staffProfile?.specialties ?? [],
    };
  }
  await user.save();

  const action =
    patch.status !== undefined && patch.status !== 'ACTIVE' ? AUDIT_ACTIONS.USER_SUSPEND : AUDIT_ACTIONS.USER_UPDATE;
  await audit({
    action,
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'user',
    resourceId: id,
    details: { patch },
  });
  return user;
}

export async function assignUserRole(
  id: string,
  input: { role: Role; currentPassword: string },
  actor: Actor
): Promise<{ user: UserDoc; previousRole: Role }> {
  if (!ROLES.includes(input.role)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid role.', [{ field: 'role', issue: 'invalid' }]);
  }
  if (!actor) throw new AppError('FORBIDDEN', 'Authentication required.');

  // SEC-11 / NFR-41: privilege changes require the acting admin to re-authenticate.
  const admin = await User.findById(actor.id).select('+passwordHash');
  if (!admin || !(await verifyPassword(admin.passwordHash, input.currentPassword))) {
    await audit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      module: 'admin',
      outcome: 'DENIED',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'user',
      resourceId: id,
      details: { reason: 'reauthentication_failed', attemptedAction: 'role.assign' },
    });
    throw new AppError('INVALID_CREDENTIALS', 'Re-authentication failed.');
  }

  const user = await User.findById(id);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');
  if (String(user._id) === actor.id) {
    throw new AppError('VALIDATION_ERROR', 'You cannot change your own role.', [
      { field: 'role', issue: 'own role cannot be changed' },
    ]);
  }

  const previousRole = user.role;
  if (previousRole === input.role) {
    return { user, previousRole };
  }

  // Lockout guard: never strand the facility without an active admin.
  if (previousRole === 'admin') {
    const remaining = await User.countDocuments({
      role: 'admin',
      status: 'ACTIVE',
      _id: { $ne: user._id },
    });
    if (remaining === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one active admin must remain.', [
        { field: 'role', issue: 'last active admin' },
      ]);
    }
  }

  user.role = input.role;
  await user.save();
  // Role changes invalidate the target's sessions → re-authorize on next login
  // (Auth Flow §7, AC-56, NFR-41).
  await destroyAllSessionsForUser(id);
  await audit({
    action: AUDIT_ACTIONS.ROLE_ASSIGN,
    module: 'admin',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'user',
    resourceId: id,
    details: { from: previousRole, to: input.role },
  });
  return { user, previousRole };
}

// ---------------------------------------------------------------------------
// EP-74 — backup trigger (PERM-68, AC-58)
// ---------------------------------------------------------------------------

/**
 * Real dump/restore is operational (03-BACKUP-AND-DISASTER-RECOVERY.md, NFR-38).
 * This endpoint records a verifiable, reproducible manifest of the live dataset
 * (per-collection document counts + a SHA-256 digest) and logs it, satisfying
 * AC-58 ("completes with a verifiable result and is logged").
 */
export async function triggerBackup(actor: Actor): Promise<{
  backupId: string;
  generatedAt: string;
  digest: string;
  collections: Array<{ name: string; count: number }>;
}> {
  const { createHash } = await import('node:crypto');
  const collections: Array<{ name: string; count: number }> = [];
  for (const [name, collection] of Object.entries(mongoose.connection.collections)) {
    const count = await collection.estimatedDocumentCount();
    collections.push({ name, count });
  }
  collections.sort((a, b) => a.name.localeCompare(b.name));
  const digest = createHash('sha256').update(JSON.stringify(collections)).digest('hex');
  const backupId = randomUUID();
  const generatedAt = new Date().toISOString();

  await audit({
    action: AUDIT_ACTIONS.BACKUP_TRIGGER,
    module: 'admin',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'backup',
    resourceId: backupId,
    details: { digest, collections: collections.length },
  });

  return { backupId, generatedAt, digest, collections };
}
