import type { Request } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { escapeRegex } from './regex.js';

/**
 * Session helpers — SEC-06 / NFR-11:
 * HTTP-only cookie sessions with idle + absolute expiry, server-side
 * invalidation on logout/password change/role change/suspension.
 *
 * The connect-mongo store TTL enforces the 12 h absolute lifetime.
 * The 30 min idle timeout is enforced in requireAuth via lastActivityAt.
 */
export const IDLE_MS = env.SESSION_IDLE_MINUTES * 60_000;

export interface SessionDataLike {
  userId?: string;
  role?: string;
  lastActivityAt?: number;
  destroy: (cb: (err?: unknown) => void) => void;
  save: (cb: (err?: unknown) => void) => void;
  touch?: () => void;
}

/** Stamp activity time; return true if the session is still within the idle window. */
export function checkAndStampIdle(session: SessionDataLike): boolean {
  const now = Date.now();
  const last = session.lastActivityAt ?? now;
  if (now - last > IDLE_MS) return false;
  session.lastActivityAt = now;
  return true;
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Invalidate ALL sessions for a user (password reset/change, role change,
 * suspension — Auth Flow §7). Operates on the store's underlying collection.
 */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  try {
    const conn = mongoose.connection;
    const collection = conn.collection('sessions');
    const filter = { session: new RegExp(`"userId":"${escapeRegex(userId)}"`) };
    const result = await collection.deleteMany(filter);
    logger.info({ userId, deleted: result.deletedCount }, 'User sessions invalidated');
  } catch (err) {
    logger.error({ err }, 'Failed to invalidate user sessions');
  }
}
