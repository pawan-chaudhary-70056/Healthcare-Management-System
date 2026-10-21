import { z } from 'zod';

/** Billing validation schemas — EP-60…66. Money is integer minor units (C-02). */

export const invoiceCreateSchema = z.object({
  patientId: z.string().length(24),
  chargeIds: z.array(z.string().length(24)).max(200).optional(),
});

export const paymentCreateSchema = z.object({
  invoiceId: z.string().length(24),
  amountMinor: z.coerce.number().int().min(1),
  method: z.enum(['CASH', 'CARD_POS', 'GATEWAY']),
  gatewayRef: z.string().max(200).optional(),
});

export const refundSchema = z.object({
  amountMinor: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(500),
});

export const discountSchema = z.object({
  amountMinor: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(500),
});
