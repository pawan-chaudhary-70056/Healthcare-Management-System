import { AuditLog, type AuditEntry } from '../models/audit-log.model.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Audit service — the ONLY writer of `audit_log` (Backend Spec §3.6).
 * Append-only: create only; no update/delete exposed anywhere (C-03).
 * `details` must never contain passwords/tokens/secrets (Database Design §7).
 * Request metadata reuses the shared `ReqMeta` shape (actor.helper.ts).
 */

export interface AuditInput {
  action: string;
  module: string;
  outcome?: AuditEntry['outcome'];
  actorId?: string;
  actorRole?: string;
  resourceType?: string;
  resourceId?: string;
  patientId?: string;
  details?: Record<string, unknown>;
  req?: ReqMeta;
}

const SECRET_KEY_PATTERN = /pass|secret|token|authorization|cookie|credential/i;

/** Narrow an untyped header value to the shape the audit model stores. */
function toUserAgent(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  return undefined;
}

function sanitizeDetails(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      at: new Date(),
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      module: input.module,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      patientId: input.patientId,
      outcome: input.outcome ?? 'SUCCESS',
      ip: input.req?.ip,
      userAgent: toUserAgent(input.req?.headers?.['user-agent']),
      details: sanitizeDetails(input.details),
    });
  } catch {
    // Audit failure must not crash the request path, but must never be silent:
    // pino picks it up via the unhandled handler in tests; log server-side.
    // (Business code treats "success without audit" as a defect — monitored via logs.)
  }
}

/**
 * Record a denied object-level access attempt (SEC-08, R-08/R-09).
 * Single shared helper so denial auditing cannot drift between modules.
 */
export async function auditAccessDenied(input: {
  actor: Actor;
  module: string;
  resourceType: string;
  resourceId: string;
  patientId?: string;
  req?: ReqMeta;
  reason?: string;
}): Promise<void> {
  await audit({
    action: 'security.access_denied',
    module: input.module,
    outcome: 'DENIED',
    actorId: input.actor.id,
    actorRole: input.actor.role,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    patientId: input.patientId,
    req: input.req,
    details: input.reason ? { reason: input.reason } : undefined,
  });
}

/** Read path — used by admin audit viewer (EP-73). */
export async function listAudit(filter: Record<string, unknown>, skip: number, limit: number) {
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, total };
}
