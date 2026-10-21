import mongoose, { Schema, type Model } from 'mongoose';
import { INVOICE_STATUS } from '../config/constants.js';

export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

/**
 * charges — atomic billable items produced by other modules (PH-05 lab,
 * PH-06 pharmacy, consultations). Consolidated into invoices (PH-07).
 * Amounts are integer minor units (C-02) — never floats.
 */
export type ChargeSourceType = 'LAB' | 'PHARMACY' | 'CONSULTATION' | 'PROCEDURE' | 'MANUAL';

export interface ChargeDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  encounterId?: mongoose.Types.ObjectId;
  sourceType: ChargeSourceType;
  sourceId?: mongoose.Types.ObjectId;
  description: string;
  amountMinor: number;
  quantity: number;
  /** Set once the charge is rolled into an invoice (immovable afterwards). */
  invoiceId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const chargeSchema = new Schema<ChargeDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', index: true },
    sourceType: { type: String, enum: ['LAB', 'PHARMACY', 'CONSULTATION', 'PROCEDURE', 'MANUAL'], required: true },
    sourceId: { type: Schema.Types.ObjectId },
    description: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', index: true },
  },
  { timestamps: true }
);

chargeSchema.index({ patientId: 1, invoiceId: 1 });

export const Charge: Model<ChargeDoc> =
  (mongoose.models.Charge as Model<ChargeDoc>) ||
  mongoose.model<ChargeDoc>('Charge', chargeSchema, 'charges');

// ---------------------------------------------------------------------------
// invoices — draft → issued (immutable) → paid/partial/refunded/cancelled
// ---------------------------------------------------------------------------

export interface InvoiceLine {
  chargeId: mongoose.Types.ObjectId;
  description: string;
  amountMinor: number;
  quantity: number;
}

export interface InvoiceDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  invoiceNo: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  /** Server-computed totals, integer minor units (C-02). */
  subtotalMinor: number;
  discountMinor: number;
  paidMinor: number;
  refundedMinor: number;
  get totalMinor(): number;
  issuedAt?: Date;
  issuedBy?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceLineSchema = new Schema(
  {
    chargeId: { type: Schema.Types.ObjectId, ref: 'Charge', required: true },
    description: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const invoiceSchema = new Schema<InvoiceDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    invoiceNo: { type: String },
    status: { type: String, enum: INVOICE_STATUS, default: 'DRAFT', required: true, index: true },
    lines: { type: [invoiceLineSchema], default: [] },
    subtotalMinor: { type: Number, required: true, min: 0, default: 0 },
    discountMinor: { type: Number, required: true, min: 0, default: 0 },
    paidMinor: { type: Number, required: true, min: 0, default: 0 },
    refundedMinor: { type: Number, required: true, min: 0, default: 0 },
    issuedAt: { type: Date },
    issuedBy: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

// Virtual total = subtotal − discount (payments tracked separately via paidMinor).
invoiceSchema.virtual('totalMinor').get(function (this: InvoiceDoc) {
  return this.subtotalMinor - this.discountMinor;
});

invoiceSchema.index({ patientId: 1, status: 1 });

export const Invoice: Model<InvoiceDoc> =
  (mongoose.models.Invoice as Model<InvoiceDoc>) ||
  mongoose.model<InvoiceDoc>('Invoice', invoiceSchema, 'invoices');

// ---------------------------------------------------------------------------
// payments — cash/POS records + gateway transactions; idempotent (SEC-23)
// ---------------------------------------------------------------------------

export type PaymentMethod = 'CASH' | 'CARD_POS' | 'GATEWAY';
export type PaymentKind = 'PAYMENT' | 'REFUND';

export interface PaymentDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  invoiceId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  kind: PaymentKind;
  method: PaymentMethod;
  amountMinor: number;
  idempotencyKey?: string;
  gatewayRef?: string;
  approvedBy?: string; // refund approver (PERM-54)
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['PAYMENT', 'REFUND'], required: true },
    method: { type: String, enum: ['CASH', 'CARD_POS', 'GATEWAY'], required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    idempotencyKey: { type: String },
    gatewayRef: { type: String },
    approvedBy: { type: String },
    recordedBy: { type: String, required: true },
  },
  { timestamps: true }
);

paymentSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'uniq_payment_idempotency' }
);

export const Payment: Model<PaymentDoc> =
  (mongoose.models.Payment as Model<PaymentDoc>) ||
  mongoose.model<PaymentDoc>('Payment', paymentSchema, 'payments');
