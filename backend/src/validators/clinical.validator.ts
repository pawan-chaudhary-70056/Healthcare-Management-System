import { z } from 'zod';

/** Clinical validation schemas — EP-30…36 (encounters, EMR, prescriptions). */

export const encounterCreateSchema = z.object({ appointmentId: z.string().length(24) });

export const emrContentSchema = z
  .object({
    symptoms: z.string().max(5000).optional(),
    examination: z.string().max(5000).optional(),
    diagnosis: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
    plan: z.string().max(5000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x && x.length > 0), {
    message: 'At least one content field is required',
  });

export const emrAmendSchema = z
  .object({
    symptoms: z.string().max(5000).optional(),
    examination: z.string().max(5000).optional(),
    diagnosis: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
    plan: z.string().max(5000).optional(),
    reason: z.string().min(3).max(1000),
  })
  .refine((v) => Object.values(v).some((x) => x && typeof x === 'string' && x.length > 0), {
    message: 'At least one content field is required',
  });

export const rxItemSchema = z.object({
  medicine: z.string().min(1).max(200),
  dose: z.string().min(1).max(100),
  frequency: z.string().min(1).max(100),
  durationDays: z.coerce.number().int().min(1).max(365),
  quantity: z.coerce.number().int().min(1).max(1000),
  notes: z.string().max(500).optional(),
});

export const prescriptionCreateSchema = z.object({
  encounterId: z.string().length(24),
  items: z.array(rxItemSchema).min(1).max(20),
  validityDays: z.coerce.number().int().min(1).max(180).optional(),
});

export const prescriptionCancelSchema = z.object({ reason: z.string().min(3).max(500) });
