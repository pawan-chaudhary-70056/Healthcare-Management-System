import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  labOrderCreateSchema,
  specimenSchema,
  custodySchema,
  resultsSchema,
  amendResultsSchema,
  labCancelSchema,
} from '../validators/laboratory.validator.js';
import * as controller from '../controllers/lab.controller.js';

/**
 * Laboratory routes — PH-05 (EP-40…46). Permissions per PERM-30…36.
 */
export const labRouter = Router();

labRouter.use(requireAuth);

const readPerms = [
  'lab.order.create',
  'lab.specimen.record',
  'lab.result.read.assigned',
  'lab.result.read.released.own',
] as const;

// EP-40 orders
labRouter.post('/orders', requirePermission('lab.order.create'), validate(labOrderCreateSchema), controller.createOrder);
labRouter.get('/orders', requirePermission([...readPerms, 'invoice.read.any']), controller.listOrders);
labRouter.get('/orders/:id', requirePermission([...readPerms]), controller.getOrder);
labRouter.post('/orders/:id/cancel', requirePermission('lab.order.create'), validate(labCancelSchema), controller.cancelOrder);

// EP-41 specimen + custody
labRouter.post('/orders/:id/specimen', requirePermission('lab.specimen.record'), validate(specimenSchema), controller.recordSpecimen);
labRouter.post('/orders/:id/custody', requirePermission('lab.specimen.record'), validate(custodySchema), controller.addCustody);

// EP-42/43 result entry + verification
labRouter.post('/orders/:id/results', requirePermission('lab.result.enter'), validate(resultsSchema), controller.enterResults);
labRouter.post('/orders/:id/verify', requirePermission('lab.result.verify'), controller.verifyResults);

// EP-46 critical acknowledgment
labRouter.post('/orders/:id/critical-ack', requirePermission(['lab.order.create', 'lab.result.verify']), controller.acknowledgeCritical);

// EP-44 release
labRouter.post('/orders/:id/release', requirePermission('lab.result.release'), validate(z.object({ releaseToPatient: z.boolean() })), controller.releaseResults);

// EP-45 amend
labRouter.post('/orders/:id/amend', requirePermission('lab.result.enter'), validate(amendResultsSchema), controller.amendResults);
