import { z } from 'zod';

/** Nursing validation — EP-37 (nursing entry). */

export const nursingEntrySchema = z.object({
  patientId: z.string().length(24),
  encounterId: z.string().length(24).optional(),
  category: z.enum(['vitals', 'medication', 'observation', 'procedure']),
  note: z.string().min(1).max(5000),
  vitalSigns: z
    .object({
      temperatureC: z.coerce.number().min(25).max(45).optional(),
      systolic: z.coerce.number().int().min(50).max(300).optional(),
      diastolic: z.coerce.number().int().min(20).max(200).optional(),
      pulseBpm: z.coerce.number().int().min(20).max(300).optional(),
      respRate: z.coerce.number().int().min(5).max(80).optional(),
      spo2: z.coerce.number().int().min(50).max(100).optional(),
    })
    .optional(),
});
