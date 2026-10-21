import { z } from 'zod';

/** Appointment validation schemas — EP-21/23/24/27. */

export const isoInstant = z.string().datetime({ offset: true });

export const bookSchema = z
  .object({
    patientId: z.string().length(24).optional(),
    doctorId: z.string().length(24),
    departmentId: z.string().length(24),
    slotStartIso: isoInstant,
    slotEndIso: isoInstant,
    serviceType: z.string().max(100).optional(),
    reasonForVisit: z.string().max(1000).optional(),
  })
  .refine((v) => v.slotEndIso > v.slotStartIso, {
    message: 'slotEndIso must be after slotStartIso',
    path: ['slotEndIso'],
  });

export const rescheduleSchema = z.object({
  slotStartIso: isoInstant,
  slotEndIso: isoInstant,
  reason: z.string().max(500).optional(),
});

export const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

export const waitlistJoinSchema = z.object({
  patientId: z.string().length(24).optional(),
  doctorId: z.string().length(24),
  departmentId: z.string().length(24),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
