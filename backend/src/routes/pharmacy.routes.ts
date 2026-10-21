import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { receiveStockSchema, stockAdjustSchema, batchReasonSchema } from '../validators/pharmacy.validator.js';
import * as controller from '../controllers/pharmacy.controller.js';

/**
 * Pharmacy routes — PH-06 (EP-50…55). Permissions per PERM-40…44.
 */
export const pharmacyRouter = Router();

pharmacyRouter.use(requireAuth);

// EP-50 GET /pharmacy/queue (prescription.validate)
pharmacyRouter.get('/queue', requirePermission('prescription.validate'), controller.validationQueue);

// EP-51 POST /pharmacy/dispense/:prescriptionId
pharmacyRouter.post('/dispense/:prescriptionId', requirePermission('prescription.dispense'), controller.dispense);

// EP-52/53 inventory — receipts, batches, movements
pharmacyRouter.post(
  '/inventory/receive',
  requirePermission('pharmacy.inventory.manage'),
  validate(receiveStockSchema),
  controller.receiveStock
);
pharmacyRouter.get('/inventory/batches', requirePermission('pharmacy.inventory.manage'), controller.listBatches);
pharmacyRouter.get('/inventory/movements', requirePermission('pharmacy.inventory.manage'), controller.listMovements);

// EP-54/55 adjustments, quarantine, recall
pharmacyRouter.post(
  '/inventory/batches/:id/adjust',
  requirePermission('pharmacy.stock.adjust'),
  validate(stockAdjustSchema),
  controller.adjustStock
);
pharmacyRouter.post(
  '/inventory/batches/:id/quarantine',
  requirePermission('pharmacy.inventory.manage'),
  validate(batchReasonSchema),
  controller.quarantineBatch
);
pharmacyRouter.post(
  '/inventory/batches/:id/recall',
  requirePermission('pharmacy.inventory.manage'),
  validate(batchReasonSchema),
  controller.recallBatch
);

// Reports & catalog
pharmacyRouter.get('/reorder', requirePermission('pharmacy.inventory.manage'), controller.reorder);
pharmacyRouter.get(
  '/drugs',
  requirePermission(['prescription.validate', 'pharmacy.inventory.manage']),
  controller.drugs
);
