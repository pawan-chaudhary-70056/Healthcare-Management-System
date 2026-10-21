import mongoose, { Schema, type Model } from 'mongoose';
import { LAB_ORDER_STATUS } from '../config/constants.js';

export type LabOrderStatus = (typeof LAB_ORDER_STATUS)[number];

/**
 * lab_orders — Database Design §3.7 (PH-05). Status ladder per Glossary §13.3:
 * ORDERED → SPECIMEN_COLLECTED → IN_PROCESS → RESULT_ENTERED → VERIFIED →
 * RELEASED (→ AMENDED). CANCELLED reachable from any pre-result state.
 */
export interface LabResultValue {
  name: string;
  value: string;
  unit?: string;
  /** Plausibility/critical flag from the analyzer or entry clerk. */
  flag?: 'normal' | 'low' | 'high' | 'critical';
}

export interface LabResultVersion {
  version: number;
  values: LabResultValue[];
  notes?: string;
  authorId: string;
  authorRole: string;
  reason?: string; // amendment reason (AC-33)
  at: Date;
}

export interface CriticalEvent {
  detectedAt: Date;
  notifiedUserId: string;
  notifiedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  escalationLevel: number;
  escalatedAt?: Date;
}

export interface LabOrderDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  encounterId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  testCode: string;
  testName: string;
  priority: 'routine' | 'urgent';
  status: LabOrderStatus;
  specimen?: {
    specimenId: string;
    type: string;
    collectedAt: Date;
    collectedBy: string;
    custody: Array<{ at: Date; by: string; action: string }>;
  };
  results?: {
    values: LabResultValue[];
    notes?: string;
    enteredBy: string;
    enteredAt: Date;
    verifiedBy?: string;
    verifiedAt?: Date;
    isCritical: boolean;
    critical?: CriticalEvent;
    versions: LabResultVersion[];
    releasedAt?: Date;
    releasedToPatient?: boolean;
  };
  /** Billing charge linked at order time (AC-34) — PH-07 consumes it. */
  chargeId?: mongoose.Types.ObjectId;
  cancelledAt?: Date;
  cancelledBy?: string;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const labResultValueSchema = new Schema(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    unit: { type: String },
    flag: { type: String, enum: ['normal', 'low', 'high', 'critical'] },
  },
  { _id: false }
);

const labVersionSchema = new Schema(
  {
    version: { type: Number, required: true },
    values: { type: [labResultValueSchema], required: true },
    notes: { type: String },
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    reason: { type: String },
    at: { type: Date, default: () => new Date(), required: true },
  },
  { _id: false }
);

const criticalEventSchema = new Schema(
  {
    detectedAt: { type: Date, required: true },
    notifiedUserId: { type: String, required: true },
    notifiedAt: { type: Date, required: true },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: String },
    escalationLevel: { type: Number, default: 0 },
    escalatedAt: { type: Date },
  },
  { _id: false }
);

const labOrderSchema = new Schema<LabOrderDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    testCode: { type: String, required: true },
    testName: { type: String, required: true },
    priority: { type: String, enum: ['routine', 'urgent'], default: 'routine' },
    status: { type: String, enum: LAB_ORDER_STATUS, default: 'ORDERED', required: true, index: true },
    specimen: {
      specimenId: { type: String },
      type: { type: String },
      collectedAt: { type: Date },
      collectedBy: { type: String },
      custody: { type: [{ at: Date, by: String, action: String }], default: [] },
    },
    results: {
      values: { type: [labResultValueSchema] },
      notes: { type: String },
      enteredBy: { type: String },
      enteredAt: { type: Date },
      verifiedBy: { type: String },
      verifiedAt: { type: Date },
      isCritical: { type: Boolean, default: false },
      critical: { type: criticalEventSchema },
      versions: { type: [labVersionSchema], default: [] },
      releasedAt: { type: Date },
      releasedToPatient: { type: Boolean, default: false },
    },
    chargeId: { type: Schema.Types.ObjectId, ref: 'Charge' },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    cancelReason: { type: String },
  },
  { timestamps: true }
);

labOrderSchema.index({ status: 1, priority: 1, createdAt: 1 });

export const LabOrder: Model<LabOrderDoc> =
  (mongoose.models.LabOrder as Model<LabOrderDoc>) ||
  mongoose.model<LabOrderDoc>('LabOrder', labOrderSchema, 'lab_orders');

/** Lab catalog — facility-defined tests with prices + critical rules (PH-05). */
export interface LabTestDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  /** Price in integer minor units (C-02). */
  priceMinor: number;
  /** Critical thresholds: flag 'critical' when value < min or > max (per unit). */
  criticalRules?: Array<{ name: string; min?: number; max?: number; unit?: string }>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const labTestSchema = new Schema<LabTestDoc>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    priceMinor: { type: Number, required: true, min: 0 },
    criticalRules: { type: [{ name: String, min: Number, max: Number, unit: String }], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const LabTest: Model<LabTestDoc> =
  (mongoose.models.LabTest as Model<LabTestDoc>) ||
  mongoose.model<LabTestDoc>('LabTest', labTestSchema, 'lab_tests');
