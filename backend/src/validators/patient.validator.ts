import { z } from 'zod';
import { CONSENT_TYPES } from '../models/patient.model.js';

/** EP-10 — patient.create (admin/receptionist) full registration. */
export const patientCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dob: z.string().date(),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().min(5).max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  identityRef: z
    .object({ type: z.string().min(1).max(50), value: z.string().min(1).max(100) })
    .optional(),
});

/** EP-12 — patient.update (staff) / patient.update.own (patient, non-identity). */
export const patientUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().min(5).max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  // Identity-critical fields: staff-only (patients must not change — FR-11/AC-11).
  dob: z.string().date().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  identityRef: z
    .object({ type: z.string().min(1).max(50), value: z.string().min(1).max(100) })
    .optional(),
});

/** EP-14 — consent manage (PERM-07). */
export const consentsPutSchema = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES),
        granted: z.boolean(),
        note: z.string().max(500).optional(),
      })
    )
    .min(1),
});

export { z };
