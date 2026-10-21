import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { audit } from '../services/audit.service.js';
import { hasAnyPermission } from '../helpers/permission.helper.js';

export { requireScope, resolveScope, auditScopeDenial, type Scope } from './scope.middleware.js';

/**
 * requirePermission — PERM-xx check (Auth Flow §5 step 2). 403 FORBIDDEN when missing.
 */
export function requirePermission(needed: string | string[]): RequestHandler {
  const list = Array.isArray(needed) ? needed : [needed];
  return (req, _res, next) => {
    if (!hasAnyPermission(req.user?.permissions, list)) {
      void audit({
        action: 'security.access_denied',
        module: 'security',
        outcome: 'DENIED',
        actorId: req.user?.id,
        actorRole: req.user?.role,
        req,
        details: { required: list, reason: 'permission' },
      });
      next(new AppError('FORBIDDEN', "You don't have access to this action."));
      return;
    }
    next();
  };
}
