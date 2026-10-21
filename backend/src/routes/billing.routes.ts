import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  invoiceCreateSchema,
  paymentCreateSchema,
  refundSchema,
  discountSchema,
} from '../validators/billing.validator.js';
import * as controller from '../controllers/billing.controller.js';

/**
 * Billing routes — PH-07 (EP-60…67). Permissions per PERM-50…55.
 * The gateway webhook route is mounted WITHOUT requireAuth (system actor) but
 * WITH mandatory signature verification (SEC-25).
 */
export const billingRouter = Router();
export const webhookRouter = Router();

billingRouter.use(requireAuth);

// EP-60/61 invoice create + issue
billingRouter.post('/invoices', requirePermission('invoice.create'), validate(invoiceCreateSchema), controller.createInvoice);
billingRouter.post('/invoices/:id/issue', requirePermission('invoice.create'), controller.issueInvoice);

// EP-63 payment recording (idempotency honoured by the service)
billingRouter.post('/payments', requirePermission('payment.record'), validate(paymentCreateSchema), controller.recordPayment);

// EP-65/66 refunds + discounts
billingRouter.post('/payments/:id/refund', requirePermission('payment.refund.approve'), validate(refundSchema), controller.refundPayment);
billingRouter.post('/invoices/:id/discount', requirePermission('invoice.amend'), validate(discountSchema), controller.applyDiscount);

// EP-67 reconciliation
billingRouter.get(
  '/reconciliation',
  requirePermission(['invoice.read.any', 'audit.read.financial']),
  controller.reconciliation
);

// EP-62 invoice list + direct object fetch
billingRouter.get('/invoices', requirePermission(['invoice.read.any', 'invoice.read.own']), controller.listInvoices);
billingRouter.get('/invoices/:id', requirePermission(['invoice.read.any', 'invoice.read.own']), controller.getInvoice);

// Gateway webhook (EP-64) — no session auth; signature-verified (SEC-25).
webhookRouter.post('/', controller.gatewayWebhook);
