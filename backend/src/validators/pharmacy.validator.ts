import { z } from 'zod';

/** Pharmacy validation schemas — EP-52…55. */

export const receiveStockSchema = z.object({
  drugCode: z.string().min(1).max(50),
  batchNo: z.string().min(1).max(100),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
});

export const stockAdjustSchema = z.object({
  delta: z.coerce.number().int(),
  reason: z.string().min(3).max(500),
});

export const batchReasonSchema = z.object({ reason: z.string().min(3).max(500) });
