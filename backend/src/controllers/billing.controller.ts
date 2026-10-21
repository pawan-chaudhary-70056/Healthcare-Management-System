import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created } from '../helpers/response.helper.js';
import * as service from '../services/billing.service.js';

/** Billing controller — EP-60…67 (thin HTTP layer; money rules live in the service). */

// EP-60 POST /billing/invoices — invoice.create (accountant)
export const createInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const inv = await service.createDraftInvoice(req.body, actorOf(req), req);
  created(res, service.serializeInvoice(inv));
});

// EP-61 POST /billing/invoices/:id/issue
export const issueInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const inv = await service.issueInvoice(req.params.id as string, actorOf(req), req);
  ok(res, service.serializeInvoice(inv));
});

// EP-63 POST /billing/payments — payment.record (accountant/receptionist)
export const recordPayment: RequestHandler = asyncHandler(async (req, res) => {
  const idempotencyKeyRaw = req.headers['idempotency-key'];
  const idempotencyKey = Array.isArray(idempotencyKeyRaw)
    ? String(idempotencyKeyRaw[0])
    : typeof idempotencyKeyRaw === 'string'
      ? idempotencyKeyRaw
      : undefined;
  const result = await service.recordPayment(
    { ...req.body, idempotencyKey },
    actorOf(req),
    req
  );
  ok(res, {
    paymentId: String(result.payment._id),
    invoice: service.serializeInvoice(result.invoice),
    replayed: result.replayed,
  });
});

// EP-65 POST /billing/payments/:id/refund — payment.refund.approve (PERM-54)
export const refundPayment: RequestHandler = asyncHandler(async (req, res) => {
  const { refund, invoice } = await service.refundPayment(
    { paymentId: req.params.id as string, ...req.body },
    actorOf(req),
    req
  );
  ok(res, { refundId: String(refund._id), invoice: service.serializeInvoice(invoice) });
});

// EP-66 POST /billing/invoices/:id/discount — invoice.amend (PERM-55)
export const applyDiscount: RequestHandler = asyncHandler(async (req, res) => {
  const inv = await service.applyDiscount(req.params.id as string, req.body, actorOf(req), req);
  ok(res, service.serializeInvoice(inv));
});

// EP-67 GET /billing/reconciliation — invoice.read.any (FR-44)
export const reconciliation: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, await service.reconciliation(actorOf(req)));
});

// EP-62 GET /billing/invoices — accountant (any) | patient (own)
export const listInvoices: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listInvoicesForActor(
    {
      patientId: req.query.patientId as string | undefined,
      status: req.query.status as string | undefined,
    },
    actorOf(req)
  );
  ok(res, items.map(service.serializeInvoice));
});

export const getInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const items = await service.listInvoicesForActor({}, actorOf(req));
  const inv = items.find((i) => String(i._id) === req.params.id);
  if (!inv) {
    ok(res, null, 404);
    return;
  }
  ok(res, service.serializeInvoice(inv));
});

// ---------------------------------------------------------------------------
// Gateway webhook (EP-64) — no session auth; signature-verified (SEC-25).
// ---------------------------------------------------------------------------
export const gatewayWebhook: RequestHandler = asyncHandler(async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const signatureHeader = req.headers['x-gateway-signature'];
  const signature = Array.isArray(signatureHeader) ? String(signatureHeader[0]) : signatureHeader;
  const result = await service.handleGatewayWebhook(
    {
      signature,
      rawBody: raw,
      event: String(req.body?.event ?? ''),
      gatewayRef: String(req.body?.gatewayRef ?? ''),
      invoiceId: req.body?.invoiceId ? String(req.body.invoiceId) : undefined,
      amountMinor: req.body?.amountMinor ? Number(req.body.amountMinor) : undefined,
    },
    { id: 'gateway', role: 'system' },
    req
  );
  ok(res, result);
});
