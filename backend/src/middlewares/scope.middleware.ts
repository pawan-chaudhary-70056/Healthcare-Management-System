import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { audit } from '../services/audit.service.js';

/**
 * requireScope — assignment/department boundary check (Auth Flow §5 step 3,
 * Backend Spec §1 `core/middleware/scope.middleware.ts`).
 *
 * Layer 1 (here): role→scope mapping — tags the request so services know the
 * widest window the actor may operate in:
 *   admin/staff refs  → 'all'
 *   doctor/reception  → 'assigned' (assignment confirmed by the owning service)
 *   patient           → 'own'      (own records only)
 *
 * Layer 2 (defense in depth, Backend Spec §3.2): services re-verify
 * assignment/ownership per object — e.g. patients service `assertCanAccessPatient`,
 * appointments scope checks — and audit every denial (R-08/R-09, SEC-08).
 */
export type Scope = 'all' | 'assigned' | 'own';

const ROLE_SCOPE: Record<string, Scope> = {
  admin: 'all',
  doctor: 'assigned',
  nurse: 'assigned',
  receptionist: 'assigned',
  lab_tech: 'assigned',
  pharmacist: 'assigned',
  patient: 'own',
};

export function resolveScope(role: string | undefined): Scope {
  return (role && ROLE_SCOPE[role]) || 'assigned';
}

interface ScopeRequest {
  user?: { id: string; role: string };
  scope?: Scope;
}

export function requireScope(_scope: 'patient' | 'encounter' | 'lab' | 'pharmacy' | 'finance'): RequestHandler {
  return (req, _res, next) => {
    const r = req as ScopeRequest;
    r.scope = resolveScope(r.user?.role);
    next();
  };
}

/** Denied-scope audit helper for services (kept beside the middleware it complements). */
export async function auditScopeDenial(input: {
  req: { ip?: string; headers?: Record<string, unknown> };
  actorId?: string;
  actorRole?: string;
  resourceType: string;
  resourceId?: string;
  patientId?: string;
  reason: string;
}): Promise<void> {
  await audit({
    action: 'security.access_denied',
    module: 'security',
    outcome: 'DENIED',
    actorId: input.actorId,
    actorRole: input.actorRole,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    patientId: input.patientId,
    req: input.req,
    details: { reason: input.reason, scope: 'object-level' },
  });
  throw new AppError('FORBIDDEN', "You don't have access to this record.");
}
