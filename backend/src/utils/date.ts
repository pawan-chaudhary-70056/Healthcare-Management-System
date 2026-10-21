/**
 * Date/time helpers — A-01: ISO 8601 UTC on the wire, facility-local rendering
 * in the UI. Schedules/exceptions are stored facility-local ('HH:mm', 'YYYY-MM-DD')
 * so slot math converts at the boundary. Facility offset is configurable policy.
 */

/** Facility timezone offset in minutes east of UTC (JS-style, e.g. +330 for IST). */
const FACILITY_UTC_OFFSET_MINUTES = Number(process.env.FACILITY_UTC_OFFSET_MINUTES ?? 0);

/** 'YYYY-MM-DD' for a UTC instant in facility-local terms. */
export function facilityDateString(date: Date): string {
  const shifted = new Date(date.getTime() + FACILITY_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Weekday (0–6, Sunday=0) of a UTC instant in facility-local terms. */
export function facilityWeekday(date: Date): number {
  const shifted = new Date(date.getTime() + FACILITY_UTC_OFFSET_MINUTES * 60_000);
  return shifted.getUTCDay();
}

/**
 * Convert a facility-local date + 'HH:mm' to a UTC Date.
 * Inverse of the two helpers above.
 */
export function facilitySlotStart(dateStr: string, timeStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  const times = timeStr.split(':').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  if (times.length < 2 || times.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid time string: ${timeStr}`);
  }
  const [y, m, d] = parts as [number, number, number];
  const [hh, mm] = times as [number, number];
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - FACILITY_UTC_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

/** Minutes between midnight and 'HH:mm'. */
export function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 0;
  const [hh, mm] = parts as [number, number];
  return hh * 60 + mm;
}

/** 'HH:mm' from minutes-since-midnight (clamped into the day). */
export function minutesToTime(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.floor(mins)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** True when the date string is a valid 'YYYY-MM-DD'. */
export function isDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's facility-local date string. */
export function todayFacility(): string {
  return facilityDateString(new Date());
}
