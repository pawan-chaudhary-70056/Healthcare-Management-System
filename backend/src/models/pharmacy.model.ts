import mongoose, { Schema, type Model } from 'mongoose';
import { BATCH_STATUS } from '../config/constants.js';

export type BatchStatus = (typeof BATCH_STATUS)[number];

/**
 * drug_catalog — PH-06 dispensable medicines with reorder levels (§2).
 */
export interface DrugDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  form: string; // tablet, syrup, injection…
  strength: string;
  reorderLevel: number;
  /** Per-unit price in integer minor units (C-02) — used for dispense charges. */
  unitPriceMinor: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const drugSchema = new Schema<DrugDoc>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    form: { type: String, required: true },
    strength: { type: String, required: true },
    reorderLevel: { type: Number, default: 50, min: 0 },
    unitPriceMinor: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Drug: Model<DrugDoc> =
  (mongoose.models.Drug as Model<DrugDoc>) ||
  mongoose.model<DrugDoc>('Drug', drugSchema, 'drugs');

/**
 * drug_batches — inventory lots (§3.9). Stock deductions happen per batch
 * (FEFO); the partial unique index guards against duplicate batch lots.
 */
export interface DrugBatchDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  drugId: mongoose.Types.ObjectId;
  batchNo: string;
  expiryDate: Date;
  quantity: number;
  initialQuantity: number;
  status: BatchStatus;
  receivedAt: Date;
  receivedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const drugBatchSchema = new Schema<DrugBatchDoc>(
  {
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    batchNo: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    initialQuantity: { type: Number, required: true, min: 0 },
    status: { type: String, enum: BATCH_STATUS, default: 'AVAILABLE', required: true, index: true },
    receivedAt: { type: Date, default: () => new Date() },
    receivedBy: { type: String, required: true },
  },
  { timestamps: true }
);

// One lot per drug+batchNo (idempotent receipts).
drugBatchSchema.index({ drugId: 1, batchNo: 1 }, { unique: true });
// FEFO picking order.
drugBatchSchema.index({ drugId: 1, status: 1, expiryDate: 1 });
// Expiry sweep target.
drugBatchSchema.index({ status: 1, expiryDate: 1 });

export const DrugBatch: Model<DrugBatchDoc> =
  (mongoose.models.DrugBatch as Model<DrugBatchDoc>) ||
  mongoose.model<DrugBatchDoc>('DrugBatch', drugBatchSchema, 'drug_batches');

/**
 * inventory_movements — append-only audit trail of every stock change (§3.9).
 */
export interface InventoryMovementDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  drugId: mongoose.Types.ObjectId;
  batchId: mongoose.Types.ObjectId;
  type: 'RECEIVE' | 'DISPENSE' | 'ADJUST' | 'QUARANTINE' | 'RECALL' | 'EXPIRE' | 'RETURN';
  delta: number; // signed change in units
  reason?: string; // mandatory for ADJUST (PERM-44, audited)
  refType?: string;
  refId?: string;
  by: string;
  createdAt: Date;
}

const inventoryMovementSchema = new Schema<InventoryMovementDoc>(
  {
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'DrugBatch', required: true, index: true },
    type: { type: String, enum: ['RECEIVE', 'DISPENSE', 'ADJUST', 'QUARANTINE', 'RECALL', 'EXPIRE', 'RETURN'], required: true },
    delta: { type: Number, required: true },
    reason: { type: String },
    refType: { type: String },
    refId: { type: String },
    by: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

inventoryMovementSchema.index({ drugId: 1, createdAt: -1 });

export const InventoryMovement: Model<InventoryMovementDoc> =
  (mongoose.models.InventoryMovement as Model<InventoryMovementDoc>) ||
  mongoose.model<InventoryMovementDoc>('InventoryMovement', inventoryMovementSchema, 'inventory_movements');

/**
 * dispense_records — one per dispense transaction (EP-51); links prescription
 * items to batches and the billing charge (AC-36 atomicity).
 */
export interface DispenseLine {
  itemIndex: number;
  batchId: mongoose.Types.ObjectId;
  quantity: number;
}

export interface DispenseRecordDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  pharmacistId: string;
  lines: DispenseLine[];
  chargeId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const dispenseRecordSchema = new Schema<DispenseRecordDoc>(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    pharmacistId: { type: String, required: true },
    lines: { type: [{ itemIndex: Number, batchId: Schema.Types.ObjectId, quantity: Number }], default: [] },
    chargeId: { type: Schema.Types.ObjectId, ref: 'Charge' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const DispenseRecord: Model<DispenseRecordDoc> =
  (mongoose.models.DispenseRecord as Model<DispenseRecordDoc>) ||
  mongoose.model<DispenseRecordDoc>('DispenseRecord', dispenseRecordSchema, 'dispense_records');
