import { Types } from 'mongoose';
import { Charge, Invoice, Payment, type InvoiceDoc, type PaymentDoc } from '../models/billing.model.js';
import { Patient } from '../models/patient.model.js';
import { AppError } from '../errors/app-error.js';
import { audit, auditAccessDenied } from './audit.service.js';
import { withTransaction } from '../helpers/transaction.helper.js';
import { IdempotencyKey, completeIdempotencyKey } from '../utils/idempotency.js';
import { asObjectId } from '../utils/object-id.js';
import { enqueue } from './notification.service.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Actor, ReqMeta } from '../helpers/actor.helper.js';

/**
 * Billing service — PH-07 (EP-60…67, FR-43…48, AC-43…49).
 * Money rules (C-02): integer minor units everywhere, server-computed totals,
 * client input never trusted. Invoices are immutable after issue (SEC-26).
 * Payments are idempotent (SEC-23): a replayed key returns the original record.
 */

/** Denial auditing is shared (services/audit.service.ts) — module is the only variance. */
const auditDenied = (
  actor: Actor,
  resourceType: string,
  resourceId: string,
  patientId?: string,
  req?: ReqMeta
): Promise<void> => auditAccessDenied({ actor, module: 'billing', resourceType, resourceId, patientId, req });

function outstandingOf(inv: InvoiceDoc): number {
  return inv.totalMinor - inv.paidMinor + inv.refundedMinor;
}

// ---------------------------------------------------------------------------
// EP-60 — consolidate unassigned charges into a DRAFT invoice (accountant)
// ---------------------------------------------------------------------------

export async function createDraftInvoice(
  input: { patientId: string; chargeIds?: string[] },
  actor: Actor,
  req?: ReqMeta
): Promise<InvoiceDoc> {
  if (actor.role !== 'accountant' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only billing staff can create invoices.');
  }
  return withTransaction(async (session) => {
    const chargeQuery: Record<string, unknown> = {
      patientId: new Types.ObjectId(input.patientId),
      invoiceId: { $exists: false },
    };
    if (input.chargeIds?.length) {
      chargeQuery._id = { $in: input.chargeIds.map((c) => new Types.ObjectId(c)) };
    }
    const charges = await Charge.find(chargeQuery).session(session);
    if (charges.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No un-invoiced charges found for this patient.', [
        { field: 'patientId', issue: 'no open charges' },
      ]);
    }

    const lines = charges.map((c) => ({
      chargeId: c._id,
      description: c.description,
      amountMinor: c.amountMinor,
      quantity: c.quantity,
    }));
    const subtotalMinor = lines.reduce((sum, l) => sum + l.amountMinor * l.quantity, 0);

    const created = await Invoice.create(
      [
        {
          patientId: new Types.ObjectId(input.patientId),
          status: 'DRAFT',
          lines,
          subtotalMinor, // server-computed (C-02)
          discountMinor: 0,
          paidMinor: 0,
          refundedMinor: 0,
          createdBy: actor.id,
        },
      ],
      { session }
    );
    const invoice = created[0]!;

    // Lock the charges to this invoice.
    await Charge.updateMany(
      { _id: { $in: charges.map((c) => c._id) } },
      { $set: { invoiceId: invoice._id } },
      { session }
    );

    await audit({
      action: AUDIT_ACTIONS.INVOICE_CREATE,
      module: 'billing',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'invoice',
      resourceId: String(invoice._id),
      patientId: input.patientId,
      req,
      details: { lineCount: lines.length, subtotalMinor },
    });
    return invoice;
  });
}

// ---------------------------------------------------------------------------
// EP-61 — issue invoice: DRAFT → ISSUED; immutable afterwards (SEC-26, AC-44)
// ---------------------------------------------------------------------------

export async function issueInvoice(
  id: string,
  actor: Actor,
  req?: ReqMeta
): Promise<InvoiceDoc> {
  if (actor.role !== 'accountant' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only billing staff can issue invoices.');
  }
  return withTransaction(async (session) => {
    const inv = await Invoice.findById(id).session(session);
    if (!inv) throw new AppError('NOT_FOUND', 'Invoice not found.');
    if (inv.status !== 'DRAFT') {
      throw new AppError('INVOICE_ISSUED', `Invoice is already ${inv.status}.`);
    }
    inv.status = 'ISSUED';
    inv.issuedAt = new Date();
    inv.issuedBy = actor.id;
    inv.invoiceNo = `INV-${inv._id.toString().slice(-8).toUpperCase()}`;
    await inv.save({ session });

    // Notify the patient (privacy-trimmed: invoice id + amount only).
    const patient = await Patient.findById(inv.patientId).select('userId').session(session);
    if (patient?.userId) {
      await enqueue(
        {
          userId: String(patient.userId),
          event: 'billing.invoice_issued',
          payload: { invoiceId: String(inv._id) },
        },
        session
      );
    }

    await audit({
      action: AUDIT_ACTIONS.INVOICE_ISSUE,
      module: 'billing',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'invoice',
      resourceId: id,
      patientId: String(inv.patientId),
      req,
      details: { invoiceNo: inv.invoiceNo, totalMinor: inv.totalMinor },
    });
    return inv;
  });
}

// ---------------------------------------------------------------------------
// EP-63 — record payment (cash/POS) or gateway confirm — idempotent (AC-45/47)
// ---------------------------------------------------------------------------

export async function recordPayment(
  input: { invoiceId: string; amountMinor: number; method: 'CASH' | 'CARD_POS' | 'GATEWAY'; idempotencyKey?: string; gatewayRef?: string },
  actor: Actor,
  req?: ReqMeta
): Promise<{ payment: PaymentDoc; invoice: InvoiceDoc; replayed: boolean }> {
  if (actor.role !== 'accountant' && actor.role !== 'receptionist' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'You cannot record payments.');
  }
  const scope = 'billing.payment';

  // Idempotency replay (SEC-23/AC-47): same key → original payment record.
  if (input.idempotencyKey) {
    const prior = await IdempotencyKey.findOne({ key: input.idempotencyKey, scope });
    if (prior && prior.resultStatus !== 0) {
      const body = prior.resultBody as { data?: { paymentId?: string } };
      if (body.data?.paymentId) {
        const payment = await Payment.findById(body.data.paymentId);
        if (payment) {
          const invoice = await Invoice.findById(payment.invoiceId);
          return { payment, invoice: invoice!, replayed: true };
        }
      }
    }
  }

  return withTransaction(async (session) => {
    const inv = await Invoice.findById(input.invoiceId).session(session);
    if (!inv) throw new AppError('NOT_FOUND', 'Invoice not found.');
    if (inv.status === 'DRAFT') {
      throw new AppError('VALIDATION_ERROR', 'Issue the invoice before recording payments.');
    }
    if (['PAID', 'REFUNDED', 'CANCELLED'].includes(inv.status)) {
      throw new AppError('INVALID_TRANSITION', `Cannot pay an invoice in status ${inv.status}.`);
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new AppError('VALIDATION_ERROR', 'amountMinor must be a positive integer (C-02).', [
        { field: 'amountMinor', issue: 'must be a positive integer' },
      ]);
    }
    const outstanding = outstandingOf(inv);
    if (input.amountMinor > outstanding) {
      throw new AppError('PAYMENT_EXCEEDS_BALANCE', `Payment exceeds outstanding balance (${outstanding} minor units).`);
    }

    // Claim the idempotency key atomically with the payment insert.
    if (input.idempotencyKey) {
      const claimed = await IdempotencyKey.create(
        [{ key: input.idempotencyKey, scope, resultStatus: 0, resultBody: {} }],
        { session }
      );
      void claimed;
    }

    const payCreated = await Payment.create(
      [
        {
          invoiceId: inv._id,
          patientId: inv.patientId,
          kind: 'PAYMENT',
          method: input.method,
          amountMinor: input.amountMinor,
          idempotencyKey: input.idempotencyKey,
          gatewayRef: input.gatewayRef,
          recordedBy: actor.id,
        },
      ],
      { session }
    );
    const payment = payCreated[0]!;

    // Exact outstanding balance computation (AC-46).
    inv.paidMinor += input.amountMinor;
    if (inv.paidMinor >= inv.totalMinor) {
      inv.status = 'PAID';
    } else if (inv.paidMinor > 0) {
      inv.status = 'PARTIALLY_PAID';
    }
    await inv.save({ session });

    if (input.idempotencyKey) {
      await completeIdempotencyKey(
        { key: input.idempotencyKey, scope },
        200,
        { data: { paymentId: String(payment._id), invoiceId: String(inv._id) } },
        session
      );
    }

    await audit({
      action: AUDIT_ACTIONS.PAYMENT_RECORD,
      module: 'billing',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'payment',
      resourceId: String(payment._id),
      patientId: String(inv.patientId),
      req,
      details: { invoiceId: String(inv._id), amountMinor: input.amountMinor, method: input.method, status: inv.status },
    });

    return { payment, invoice: inv, replayed: false };
  }).catch((err) => {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError('DUPLICATE_REQUEST', 'This payment is already being processed.');
    }
    throw err;
  });
}

// ---------------------------------------------------------------------------
// EP-64 — gateway webhook: signature-verified (SEC-25, AC-45)
// ---------------------------------------------------------------------------

export async function handleGatewayWebhook(
  input: { signature: string | undefined; rawBody: string; event: string; gatewayRef: string; invoiceId?: string; amountMinor?: number },
  actor: Actor,
  req?: ReqMeta
): Promise<{ processed: boolean }> {
  const expected = gatewaySignature(input.rawBody);
  if (!input.signature || input.signature !== expected) {
    await audit({
      action: AUDIT_ACTIONS.PAYMENT_WEBHOOK,
      module: 'billing',
      outcome: 'DENIED',
      // actorId must be a valid ObjectId or omitted (schema cast); identity
      // context goes in details instead.
      resourceType: 'webhook',
      req,
      details: { reason: 'signature mismatch', actor: 'gateway' },
    });
    throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }

  if (input.event === 'payment.succeeded' && input.invoiceId && input.amountMinor) {
    // Route through the idempotent recorder as the system actor.
    await recordPayment(
      {
        invoiceId: input.invoiceId,
        amountMinor: input.amountMinor,
        method: 'GATEWAY',
        idempotencyKey: `gw:${input.gatewayRef}`,
        gatewayRef: input.gatewayRef,
      },
      actor,
      req
    );
  }
  return { processed: true };
}

/** Deterministic HMAC-style signature over the raw body (sandbox gateway). */
export function gatewaySignature(rawBody: string): string {
  // Sandbox: simple deterministic digest. Real deployments swap in the
  // provider's HMAC verification via the adapter seam (A-04, PH-08).
  let hash = 5381;
  for (let i = 0; i < rawBody.length; i += 1) {
    hash = ((hash << 5) + hash + rawBody.charCodeAt(i)) >>> 0;
  }
  return `sbx-${hash.toString(16)}`;
}

// ---------------------------------------------------------------------------
// EP-65 — refunds with approval (PERM-54, AC-48) · EP-66 discounts
// ---------------------------------------------------------------------------

export async function refundPayment(
  input: { paymentId: string; amountMinor: number; reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<{ refund: PaymentDoc; invoice: InvoiceDoc }> {
  if (actor.role !== 'accountant' && actor.role !== 'admin') {
    await auditDenied(actor, 'payment', input.paymentId, undefined, req);
    throw new AppError('REFUND_NOT_AUTHORIZED', 'Only billing staff can approve refunds.');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'A refund reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  return withTransaction(async (session) => {
    const payment = await Payment.findById(input.paymentId).session(session);
    if (!payment || payment.kind !== 'PAYMENT') {
      throw new AppError('NOT_FOUND', 'Original payment not found.');
    }
    const inv = await Invoice.findById(payment.invoiceId).session(session);
    if (!inv) throw new AppError('NOT_FOUND', 'Invoice not found.');
    if (input.amountMinor <= 0 || input.amountMinor > payment.amountMinor) {
      throw new AppError('VALIDATION_ERROR', 'Refund must be positive and ≤ original payment.');
    }

    const refundCreated = await Payment.create(
      [
        {
          invoiceId: inv._id,
          patientId: inv.patientId,
          kind: 'REFUND',
          method: payment.method,
          amountMinor: input.amountMinor,
          approvedBy: actor.id,
          recordedBy: actor.id,
        },
      ],
      { session }
    );
    const refund = refundCreated[0]!;

    inv.refundedMinor += input.amountMinor;
    // Status transitions per Glossary §13.2 — refund may revert PAID.
    if (inv.refundedMinor >= inv.paidMinor) {
      inv.status = 'REFUNDED';
    } else if (inv.status === 'PAID') {
      inv.status = 'PARTIALLY_PAID';
    }
    await inv.save({ session });

    await audit({
      action: AUDIT_ACTIONS.REFUND_APPROVE,
      module: 'billing',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'payment',
      resourceId: String(refund._id),
      patientId: String(inv.patientId),
      req,
      details: { originalPaymentId: input.paymentId, amountMinor: input.amountMinor, reason: input.reason.trim() },
    });
    return { refund, invoice: inv };
  });
}

export async function applyDiscount(
  invoiceId: string,
  input: { amountMinor: number; reason: string },
  actor: Actor,
  req?: ReqMeta
): Promise<InvoiceDoc> {
  if (actor.role !== 'accountant' && actor.role !== 'admin') {
    await auditDenied(actor, 'invoice', invoiceId, undefined, req);
    throw new AppError('FORBIDDEN', 'Only billing staff can apply discounts.');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'A discount reason is required.', [
      { field: 'reason', issue: 'required' },
    ]);
  }
  const inv = await Invoice.findById(invoiceId);
  if (!inv) throw new AppError('NOT_FOUND', 'Invoice not found.');
  if (inv.status === 'CANCELLED' || inv.status === 'REFUNDED') {
    throw new AppError('INVALID_TRANSITION', `Cannot discount an invoice in status ${inv.status}.`);
  }
  if (input.amountMinor <= 0 || input.amountMinor > inv.subtotalMinor - inv.discountMinor) {
    throw new AppError('VALIDATION_ERROR', 'Discount must be positive and not exceed the invoice total.');
  }
  inv.discountMinor += input.amountMinor;
  await inv.save();

  await audit({
    action: AUDIT_ACTIONS.DISCOUNT_APPLY,
    module: 'billing',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'invoice',
    resourceId: invoiceId,
    patientId: String(inv.patientId),
    req,
    details: { amountMinor: input.amountMinor, reason: input.reason.trim(), newTotalMinor: inv.totalMinor },
  });
  return inv;
}

// ---------------------------------------------------------------------------
// EP-67 — reconciliation view (FR-44, AC-49)
// ---------------------------------------------------------------------------

export async function reconciliation(actor: Actor): Promise<{
  totals: { invoicedMinor: number; paidMinor: number; refundedMinor: number; outstandingMinor: number };
  byStatus: Record<string, number>;
  paymentCount: number;
}> {
  if (actor.role !== 'accountant' && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only billing staff can view reconciliation.');
  }
  const invoices = await Invoice.find({ status: { $ne: 'DRAFT' } }).limit(5000);
  let invoiced = 0;
  let paid = 0;
  let refunded = 0;
  const byStatus: Record<string, number> = {};
  for (const inv of invoices) {
    invoiced += inv.totalMinor;
    paid += inv.paidMinor;
    refunded += inv.refundedMinor;
    byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1;
  }
  const paymentCount = await Payment.countDocuments({ kind: 'PAYMENT' });
  return {
    totals: {
      invoicedMinor: invoiced,
      paidMinor: paid,
      refundedMinor: refunded,
      outstandingMinor: invoiced - paid + refunded,
    },
    byStatus,
    paymentCount,
  };
}

// ---------------------------------------------------------------------------
// Reads — patient sees own invoices only (FR-47)
// ---------------------------------------------------------------------------

export async function listInvoicesForActor(
  filter: { patientId?: string; status?: string },
  actor: Actor
): Promise<InvoiceDoc[]> {
  const query: Record<string, unknown> = {};
  if (actor.role === 'patient') {
    const own = await Patient.findOne({ userId: new Types.ObjectId(actor.id) }).select('_id');
    if (!own) return [];
    query.patientId = own._id;
  } else if (actor.role === 'accountant' || actor.role === 'admin' || actor.role === 'receptionist') {
    if (filter.patientId) query.patientId = asObjectId(filter.patientId, 'patientId');
  } else {
    throw new AppError('FORBIDDEN', 'You cannot view invoices.');
  }
  if (filter.status) query.status = filter.status;
  return Invoice.find(query).sort({ createdAt: -1 }).limit(200);
}

export function serializeInvoice(inv: InvoiceDoc): Record<string, unknown> {
  return {
    id: String(inv._id),
    invoiceNo: inv.invoiceNo,
    patientId: String(inv.patientId),
    status: inv.status,
    lines: inv.lines.map((l) => ({
      description: l.description,
      amountMinor: l.amountMinor,
      quantity: l.quantity,
    })),
    subtotalMinor: inv.subtotalMinor,
    discountMinor: inv.discountMinor,
    totalMinor: inv.totalMinor,
    paidMinor: inv.paidMinor,
    refundedMinor: inv.refundedMinor,
    outstandingMinor: outstandingOf(inv),
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}
