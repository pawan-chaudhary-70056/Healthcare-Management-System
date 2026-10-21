import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  policyValueSchema,
  breakGlassRequestSchema,
  breakGlassReviewSchema,
} from '../validators/admin.validator.js';
import * as controller from '../controllers/platform.controller.js';

/**
 * Platform routes — PH-08 (EP-70…77). Permissions per PERM-60…68.
 */
export const platformRouter = Router();

platformRouter.use(requireAuth);

// Notifications — in-app bell (any authenticated user sees their own)
platformRouter.get('/notifications', controller.notifications);

// Settings / policy engine (EP-72)
platformRouter.get('/settings/policy', requirePermission('settings.manage'), controller.getPolicy);
platformRouter.put(
  '/settings/policy/:key',
  requirePermission('settings.manage'),
  validate(policyValueSchema),
  controller.setPolicy
);

// Audit viewer (EP-73)
platformRouter.get(
  '/audit',
  requirePermission(['audit.read.all', 'audit.read.own-events', 'audit.read.financial']),
  controller.auditLog
);

// Break-glass (EP-76/77)
platformRouter.post(
  '/break-glass',
  requirePermission('breakglass.use'),
  validate(breakGlassRequestSchema),
  controller.requestBreakGlass
);
platformRouter.post('/break-glass/:id/revoke', requirePermission('breakglass.use'), controller.revokeBreakGlass);
platformRouter.post(
  '/break-glass/:id/review',
  requirePermission('breakglass.review'),
  validate(breakGlassReviewSchema),
  controller.reviewBreakGlass
);
platformRouter.get('/break-glass', requirePermission('breakglass.review'), controller.listBreakGlass);
