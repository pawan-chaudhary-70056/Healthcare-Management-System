import type { ClientSession, Types } from 'mongoose';
import { Notification, type NotificationChannel, type NotificationDoc } from '../models/notification.model.js';
import { logger } from '../config/logger.js';
import { getPolicy } from '../config/policy.loader.js';

/**
 * Minimal notification queue (PH-03). Enqueue is safe to call inside the
 * business transaction (Database Design §6); delivery happens in drain(),
 * a background pass — never inside the critical transaction.
 *
 * External channels (email/SMS) require providers configured; until then only
 * in_app rows reach SENT (AC-52: email/SMS only if providers are configured).
 */

export interface EnqueueInput {
  userId: string;
  event: NotificationDoc['event'];
  channel?: NotificationChannel;
  payload: NotificationDoc['payload'];
}

export async function enqueue(input: EnqueueInput, session?: ClientSession): Promise<void> {
  const channel: NotificationChannel = input.channel ?? 'in_app';
  // External providers not configured yet → queue in_app only (AC-52).
  await Notification.create(
    [
      {
        userId: input.userId,
        channel,
        event: input.event,
        payload: input.payload,
        status: 'QUEUED',
      },
    ],
    { session }
  );
}

/** Background drain: mark QUEUED in_app notifications as SENT (delivered when read). */
export async function drainQueue(limit = 50): Promise<number> {
  const queued = await Notification.find({ status: 'QUEUED', channel: 'in_app' })
    .sort({ createdAt: 1 })
    .limit(limit);
  let sent = 0;
  for (const n of queued) {
    n.status = 'SENT';
    n.sentAt = new Date();
    await n.save();
    sent += 1;
  }
  if (sent > 0) logger.debug({ sent }, 'Notification queue drained');
  return sent;
}

/** Read path (unused by HTTP; kept for tests / future external adapters). */
export async function listForUser(userId: string, skip: number, lim: number) {
  const [items, total] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
    Notification.countDocuments({ userId }),
  ]);
  return { items, total };
}

/**
 * Appointment reminders (Build TODOs PH-03, AC-20): for appointments in the
 * reminder window (lead hours before slot start), enqueue ONE reminder per
 * appointment per patient — de-duplicated via the reminderSent flag and a
 * unique index guard. Content stays privacy-trimmed: date/time/department only
 * (NFR-16). Reminder sweep runs as a system actor — no user-initiated data is
 * bypassed; recipients are derived from the appointment itself.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  // Imported lazily to avoid a circular import (appointments.service → enqueue).
  const { Appointment } = await import('../models/appointment.model.js');
  const leadMs = getPolicy().REMINDER_LEAD_HOURS * 60 * 60_000;

  const due = await Appointment.find({
    status: { $in: ['SCHEDULED', 'CONFIRMED'] },
    activeSlot: true,
    'slot.start': { $gte: now, $lte: new Date(now.getTime() + leadMs) },
  })
    .select('_id patientId departmentId slot.start')
    .populate<{ departmentId: { name?: string } | Types.ObjectId }>('departmentId', 'name')
    .limit(500)
    .lean();

  let queued = 0;
  for (const appt of due) {
    const patient = (await (
      await import('../models/patient.model.js')
    ).Patient.findById(appt.patientId).select('userId')) as { userId?: Types.ObjectId } | null;
    if (!patient?.userId) continue;

    const deptName =
      appt.departmentId && typeof appt.departmentId === 'object' && 'name' in appt.departmentId
        ? appt.departmentId.name
        : undefined;

    const result = await Notification.updateOne(
      {
        userId: patient.userId,
        event: 'appointment.reminder',
        appointmentId: appt._id,
      },
      {
        $setOnInsert: {
          userId: patient.userId,
          channel: 'in_app',
          event: 'appointment.reminder',
          payload: {
            appointmentId: String(appt._id),
            department: deptName,
            slotStartIso: appt.slot.start.toISOString(),
          },
          status: 'QUEUED',
          reminderSent: true,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount === 1) queued += 1; // new reminder only
  }

  if (queued > 0) logger.debug({ queued }, 'Appointment reminders enqueued');
  return queued;
}
