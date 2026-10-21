import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { patientCreateSchema, patientUpdateSchema, consentsPutSchema } from '../validators/patient.validator.js';
import * as controller from '../controllers/patient.controller.js';

/**
 * Patients routes — API Standards §3.3 (EP-10…14).
 * Every route declares its permission; object-level checks live in the service
 * (ownership middleware pattern) and denials are audited there (R-08/R-09).
 */
export const patientRouter = Router();

patientRouter.use(requireAuth);

// EP-10 POST /patients — patient.create (admin, receptionist)
patientRouter.post('/', requirePermission('patient.create'), validate(patientCreateSchema), controller.create);

// EP-11 GET /patients/:id — role projection + object/scope check
patientRouter.get(
  '/:id',
  requirePermission(['patient.read.own', 'patient.read.assigned', 'patient.read.all']),
  controller.getById
);

// EP-12 PATCH /patients/:id — patient.update | patient.update.own
patientRouter.patch(
  '/:id',
  requirePermission(['patient.update', 'patient.update.own']),
  validate(patientUpdateSchema),
  controller.update
);

// EP-13 GET /patients/:id/summary — care-team scope
patientRouter.get('/:id/summary', requirePermission(['patient.read.assigned', 'patient.read.own']), controller.summary);

// EP-14 PUT /patients/:id/consents — patient.consent.manage
patientRouter.put('/:id/consents', requirePermission('patient.consent.manage'), validate(consentsPutSchema), controller.putConsents);

// Staff patient search (supports booking flows) — patient.create grants the
// receptionist/admin booking lookup (R-06); projections stay minimum-necessary.
patientRouter.get(
  '/',
  requirePermission(['patient.read.all', 'patient.read.assigned', 'patient.create']),
  controller.list
);
