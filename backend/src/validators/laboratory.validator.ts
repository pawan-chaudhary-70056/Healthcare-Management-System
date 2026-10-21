import { z } from 'zod';

/** Laboratory validation schemas — EP-40…45. */

export const resultValueSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().min(1).max(200),
  unit: z.string().max(30).optional(),
  flag: z.enum(['normal', 'low', 'high', 'critical']).optional(),
});

export const labOrderCreateSchema = z.object({
  encounterId: z.string().length(24),
  testCode: z.string().min(1).max(50),
  priority: z.enum(['routine', 'urgent']).optional(),
});

export const specimenSchema = z.object({
  specimenId: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  collectedAt: z.string().datetime({ offset: true }).optional(),
});

export const custodySchema = z.object({ action: z.string().min(2).max(100) });

export const resultsSchema = z.object({
  values: z.array(resultValueSchema).min(1).max(50),
  notes: z.string().max(2000).optional(),
});

export const amendResultsSchema = resultsSchema.extend({ reason: z.string().min(3).max(1000) });

export const labCancelSchema = z.object({ reason: z.string().min(3).max(500) });
