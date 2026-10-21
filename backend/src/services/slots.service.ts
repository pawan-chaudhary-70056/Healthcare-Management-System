import { Types } from 'mongoose';
import { DoctorSchedule, ScheduleException } from '../models/doctor-schedule.model.js';
import { Appointment } from '../models/appointment.model.js';
import { getPolicy } from '../config/policy.loader.js';
import {
  facilityDateString,
  facilitySlotStart,
  timeToMinutes,
  minutesToTime,
} from '../utils/date.js';
import type { AppointmentStatus } from '../models/appointment.model.js';

/**
 * Slot computation on read — Database Design §3.2, FR-57, AC-63, EP-20.
 * offerable = doctor_schedules template for that weekday
 *           − existing non-cancelled appointments (status occupied)
 *           − schedule_exceptions for that date
 *           − booking horizon policy
 * No slots collection is stored; the result is always derived from live data,
 * so schedule edits take effect without deploy (AC-63).
 */

/** Statuses that occupy a slot. */
export const OCCUPYING_STATUSES: AppointmentStatus[] = [
  'REQUESTED',
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_CONSULTATION',
];

export interface Slot {
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
}

export async function listSlotsForDoctorDate(
  doctorId: string,
  date: string // facility-local 'YYYY-MM-DD'
): Promise<Slot[]> {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return [];
  const weekday = day.getUTCDay();

  // Booking horizon: today (facility-local) + N days inclusive.
  const today = facilityDateString(new Date());
  const horizonEnd = new Date(`${today}T00:00:00Z`);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + getPolicy().BOOKING_HORIZON_DAYS);
  if (date < today || date > horizonEnd.toISOString().slice(0, 10)) {
    return [];
  }

  const schedules = await DoctorSchedule.find({
    doctorId: new Types.ObjectId(doctorId),
    weekday,
    active: true,
  }).lean();
  if (schedules.length === 0) return [];

  const exception = await ScheduleException.findOne({
    doctorId: new Types.ObjectId(doctorId),
    date,
  }).lean();

  // CLOSED day → no slots (AC-63).
  if (exception && exception.type === 'CLOSED') return [];

  const occupied = await Appointment.find({
    doctorId: new Types.ObjectId(doctorId),
    status: { $in: OCCUPYING_STATUSES },
    'slot.start': {
      $gte: facilitySlotStart(date, '00:00'),
      $lt: facilitySlotStart(nextDate(date), '00:00'),
    },
  })
    .select('slot.start')
    .lean();
  const occupiedStarts = new Set(occupied.map((a) => a.slot.start.toISOString()));

  // Template ranges (or CUSTOM exception ranges that replace the template).
  const ranges: Array<{ startMin: number; endMin: number; slotLen: number }> = [];
  if (exception && exception.type === 'CUSTOM' && exception.customSlots) {
    for (const cs of exception.customSlots) {
      ranges.push({
        startMin: timeToMinutes(cs.start),
        endMin: timeToMinutes(cs.end),
        slotLen: Math.min(...schedules.map((s) => s.slotLengthMinutes)),
      });
    }
  } else {
    for (const s of schedules) {
      ranges.push({
        startMin: timeToMinutes(s.startTime),
        endMin: timeToMinutes(s.endTime),
        slotLen: s.slotLengthMinutes,
      });
    }
  }

  const slots: Slot[] = [];
  for (const range of ranges) {
    for (let m = range.startMin; m + range.slotLen <= range.endMin; m += range.slotLen) {
      const start = facilitySlotStart(date, minutesToTime(m));
      const end = facilitySlotStart(date, minutesToTime(m + range.slotLen));
      if (occupiedStarts.has(start.toISOString())) continue;
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/** True when the exact slot is currently offerable (used in-transaction too). */
export async function isSlotAvailable(
  doctorId: string,
  start: Date,
  end: Date
): Promise<boolean> {
  const date = facilityDateString(start);
  const all = await listSlotsForDoctorDate(doctorId, date);
  const key = start.toISOString();
  return all.some((s) => s.start === key && new Date(s.end).getTime() === end.getTime());
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
