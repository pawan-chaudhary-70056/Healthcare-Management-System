/**
 * Booking request helpers (EP-21 contract).
 * - The API mandates an Idempotency-Key header on booking (428 otherwise,
 *   API Standards §4.3 / SEC-23). Keys are unique per booking attempt —
 *   retries of the SAME attempt reuse the key so the server replays the
 *   original result instead of double-booking.
 * - Booking requires a departmentId; the public doctor directory carries the
 *   department NAME, so callers resolve name → id via /public/departments.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `bk-${crypto.randomUUID()}`;
  }
  return `bk-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Resolve a department name (from the doctor directory) to its id. */
export function departmentIdByName(
  departments: Array<{ _id?: string; id?: string; name: string }> | undefined,
  name: string | undefined
): string {
  if (!departments || !name) return '';
  const hit = departments.find((d) => d.name === name);
  return String(hit?._id ?? hit?.id ?? '');
}
