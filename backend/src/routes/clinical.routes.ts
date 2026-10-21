import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  encounterCreateSchema,
  emrContentSchema,
  emrAmendSchema,
  prescriptionCreateSchema,
  prescriptionCancelSchema,
} from '../validators/clinical.validator.js';
import { nursingEntrySchema } from '../validators/nursing.validator.js';
import * as controller from '../controllers/clinical.controller.js';

/**
 * Clinical & nursing routes — PH-04 (EP-30…38).
 * Every route declares its permission; object-level scope checks re-verify in
 * the service (defense in depth).
 */
export const clinicalRouter = Router();

clinicalRouter.use(requireAuth);

// Encounters (EP-30)
clinicalRouter.post('/encounters', requirePermission('encounter.create'), validate(encounterCreateSchema), controller.createEncounter);
clinicalRouter.get('/encounters/open', requirePermission('encounter.create'), controller.listOpenEncounters);
clinicalRouter.get('/encounters/:id', requirePermission('encounter.create'), controller.getEncounter);
clinicalRouter.post('/encounters/:id/finalize', requirePermission('encounter.create'), controller.finalizeEncounter);

// EMR entries (EP-31…34)
clinicalRouter.post('/encounters/:id/emr', requirePermission('emr.write'), validate(emrContentSchema), controller.writeEmr);
clinicalRouter.get(
  '/encounters/:id/emr',
  requirePermission(['emr.read.assigned', 'emr.read.released.own']),
  controller.listEmr
);
clinicalRouter.post('/emr/:entryId/finalize', requirePermission('emr.write'), controller.finalizeEmr);
clinicalRouter.post('/emr/:entryId/amend', requirePermission('emr.amend'), validate(emrAmendSchema), controller.amendEmr);
clinicalRouter.get('/emr/:entryId/versions', requirePermission('emr.read.assigned'), controller.emrVersions);
clinicalRouter.post('/emr/:entryId/release', requirePermission('emr.write'), controller.releaseEmr);

// Prescriptions (EP-35/36)
clinicalRouter.post('/prescriptions', requirePermission('prescription.create'), validate(prescriptionCreateSchema), controller.createPrescription);
clinicalRouter.get(
  '/prescriptions',
  requirePermission(['prescription.create', 'prescription.read.own', 'prescription.validate']),
  controller.listPrescriptions
);
clinicalRouter.post('/prescriptions/:id/cancel', requirePermission('prescription.create'), validate(prescriptionCancelSchema), controller.cancelPrescription);

// Nursing entries (EP-37/38)
clinicalRouter.post('/nursing-entries', requirePermission('nursing.entry.create'), validate(nursingEntrySchema), controller.createNursingEntry);
clinicalRouter.get(
  '/nursing-entries',
  requirePermission(['nursing.entry.create', 'emr.read.assigned', 'emr.read.released.own']),
  controller.listNursingEntries
);
