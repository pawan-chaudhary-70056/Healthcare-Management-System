import { z } from 'zod';
import { ROLES, USER_STATUS } from '../config/constants.js';

/** Admin & platform validation schemas — EP-70/71/72/76 + reference data (EP-71a/b). */

// ---- Reference data (departments / schedules / exceptions) ----------------
export const departmentCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  publicVisible: z.boolean().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export const departmentUpdateSchema = departmentCreateSchema.partial();

export const scheduleCreateSchema = z.object({
  doctorId: z.string().length(24),
  departmentId: z.string().length(24),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  slotLengthMinutes: z.number().int().min(5).max(240),
});

export const scheduleUpdateSchema = scheduleCreateSchema
  .partial()
  .omit({ doctorId: true, departmentId: true, weekday: true });

export const exceptionCreateSchema = z
  .object({
    doctorId: z.string().length(24),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(['CLOSED', 'CUSTOM']),
    customSlots: z
      .array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }))
      .optional(),
  })
  .refine((v) => v.type !== 'CUSTOM' || (v.customSlots?.length ?? 0) > 0, {
    message: 'CUSTOM exceptions require customSlots',
    path: ['customSlots'],
  });

// ---- User & role management (EP-70/71, PERM-60/61) ------------------------
const strongPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const userCreateSchema = z.object({
  email: z.string().email(),
  password: strongPassword,
  role: z.enum(ROLES), // service rejects 'patient' (staff-only here)
  fullName: z.string().min(1).max(120).optional(),
  department: z.string().max(120).optional(),
  specialties: z.array(z.string().max(120)).max(20).optional(),
});

// Doctor provisioning shares the EP-70 password rule — no predictable defaults.
export const doctorUserCreateSchema = userCreateSchema.pick({ email: true, password: true }).extend({
  fullName: z.string().min(1).max(120),
  department: z.string().max(120).optional(),
  specialties: z.array(z.string().max(120)).max(20).optional(),
});

export const userUpdateSchema = z.object({
  status: z.enum(USER_STATUS).optional(),
  fullName: z.string().min(1).max(120).optional(),
  department: z.string().max(120).optional(),
  specialties: z.array(z.string().max(120)).max(20).optional(),
});

// SEC-11/NFR-41: role changes require the acting admin to re-authenticate.
export const roleAssignSchema = z.object({
  role: z.enum(ROLES),
  currentPassword: z.string().min(1),
});

// ---- Platform settings & break-glass (EP-72/76/77) ------------------------
export const policyValueSchema = z.object({ value: z.coerce.number().min(0) });

export const breakGlassRequestSchema = z.object({
  patientId: z.string().length(24),
  reason: z.string().min(10).max(1000),
});

export const breakGlassReviewSchema = z.object({ notes: z.string().min(3).max(2000) });
