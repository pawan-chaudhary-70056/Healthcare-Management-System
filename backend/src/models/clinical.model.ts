import mongoose, { Schema, type Model } from 'mongoose';
import { PRESCRIPTION_STATUS } from '../config/constants.js';

export type PrescriptionStatus = (typeof PRESCRIPTION_STATUS)[number];

/**
 * encounters — Database Design §3.5 (PH-04).
 * An encounter is the ONLY door into clinical documentation (FR-21/AC-22):
 * it is created by the doctor when calling a CHECKED_IN patient, and the
 * linked appointment moves IN_CONSULTATION (T-05) in the same transaction.
 */
export const ENCOUNTER_STATUS = ['OPEN', 'FINALIZED', 'AMENDED'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUS)[number];

export interface EncounterDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  appointmentId: mongoose.Types.ObjectId;
  status: EncounterStatus;
  finalizedAt?: Date;
  finalizedBy?: string;
  /** Set when an amendment is recorded post-finalization (AC-24). */
  amendedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const encounterSchema = new Schema<EncounterDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Appointment',
      required: true,
      index: true,
    },
    status: { type: String, enum: ENCOUNTER_STATUS, default: 'OPEN', required: true },
    finalizedAt: { type: Date },
    finalizedBy: { type: String },
    amendedAt: { type: Date },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

// One open encounter per appointment — encounters are created once per visit.
encounterSchema.index(
  { appointmentId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['OPEN', 'FINALIZED'] } }, name: 'uniq_encounter_per_appointment' }
);
encounterSchema.index({ doctorId: 1, createdAt: -1 });

export const Encounter: Model<EncounterDoc> =
  (mongoose.models.Encounter as Model<EncounterDoc>) ||
  mongoose.model<EncounterDoc>('Encounter', encounterSchema, 'encounters');

// ---------------------------------------------------------------------------
// emr_entries — draft → finalize → amend with immutable version history (C-04)
// ---------------------------------------------------------------------------

export interface EmrVersionDoc {
  version: number;
  content: {
    symptoms?: string;
    examination?: string;
    diagnosis?: string;
    notes?: string;
    plan?: string;
  };
  authorId: string;
  authorRole: string;
  reason?: string; // amendment reason (AC-24)
  at: Date;
}

export interface EmrEntryDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  encounterId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  authorId: string;
  authorRole: string;
  status: 'DRAFT' | 'FINALIZED';
  /** Current content (head). Prior content lives immutably in versions. */
  content: EmrVersionDoc['content'];
  version: number;
  versions: EmrVersionDoc[];
  finalizedAt?: Date;
  /** Patient-visible summary released per policy (AC-27, FR-25). */
  releasedToPatient: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const emrContentSchema = new Schema(
  {
    symptoms: { type: String },
    examination: { type: String },
    diagnosis: { type: String },
    notes: { type: String },
    plan: { type: String },
  },
  { _id: false }
);

const emrVersionSchema = new Schema(
  {
    version: { type: Number, required: true },
    content: { type: emrContentSchema, required: true },
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    reason: { type: String },
    at: { type: Date, default: () => new Date(), required: true },
  },
  { _id: false }
);

const emrEntrySchema = new Schema<EmrEntryDoc>(
  {
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    status: { type: String, enum: ['DRAFT', 'FINALIZED'], default: 'DRAFT', required: true },
    content: { type: emrContentSchema, required: true },
    version: { type: Number, default: 1, required: true },
    versions: { type: [emrVersionSchema], default: [] },
    finalizedAt: { type: Date },
    releasedToPatient: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const EmrEntry: Model<EmrEntryDoc> =
  (mongoose.models.EmrEntry as Model<EmrEntryDoc>) ||
  mongoose.model<EmrEntryDoc>('EmrEntry', emrEntrySchema, 'emr_entries');

// ---------------------------------------------------------------------------
// prescriptions — created from consultation; visible to pharmacy + patient
// ---------------------------------------------------------------------------

export interface PrescriptionItem {
  medicine: string;
  dose: string;
  frequency: string;
  durationDays: number;
  notes?: string;
  quantity: number; // units to dispense (pharmacy picks FEFO batches)
}

export interface PrescriptionDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  encounterId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  items: PrescriptionItem[];
  status: PrescriptionStatus;
  /** Remaining quantities per item (pharmacy deductions tracked per index). */
  dispensedQty: number[];
  cancelledAt?: Date;
  cancelledBy?: string;
  cancelReason?: string;
  expiresAt: Date; // daily EXPIRED sweep (PH-06)
  createdAt: Date;
  updatedAt: Date;
}

const prescriptionItemSchema = new Schema(
  {
    medicine: { type: String, required: true, trim: true },
    dose: { type: String, required: true, trim: true },
    frequency: { type: String, required: true, trim: true },
    durationDays: { type: Number, required: true, min: 1 },
    notes: { type: String },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const prescriptionSchema = new Schema<PrescriptionDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [prescriptionItemSchema], required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'PARTIALLY_DISPENSED', 'FULLY_DISPENSED', 'CANCELLED', 'EXPIRED'],
      default: 'ACTIVE',
      required: true,
      index: true,
    },
    dispensedQty: { type: [Number], default: [] },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    cancelReason: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

prescriptionSchema.index({ status: 1, expiresAt: 1 });

export const Prescription: Model<PrescriptionDoc> =
  (mongoose.models.Prescription as Model<PrescriptionDoc>) ||
  mongoose.model<PrescriptionDoc>('Prescription', prescriptionSchema, 'prescriptions');

// ---------------------------------------------------------------------------
// nursing_entries — assigned-scope notes (PERM-24, EP-37/38)
// ---------------------------------------------------------------------------

export interface NursingEntryDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  encounterId?: mongoose.Types.ObjectId;
  nurseId: string;
  category: 'vitals' | 'medication' | 'observation' | 'procedure';
  vitalSigns?: {
    temperatureC?: number;
    systolic?: number;
    diastolic?: number;
    pulseBpm?: number;
    respRate?: number;
    spo2?: number;
  };
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const nursingEntrySchema = new Schema<NursingEntryDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', index: true },
    nurseId: { type: String, required: true },
    category: {
      type: String,
      enum: ['vitals', 'medication', 'observation', 'procedure'],
      required: true,
    },
    vitalSigns: {
      temperatureC: { type: Number },
      systolic: { type: Number },
      diastolic: { type: Number },
      pulseBpm: { type: Number },
      respRate: { type: Number },
      spo2: { type: Number },
    },
    note: { type: String, required: true },
  },
  { timestamps: true }
);

export const NursingEntry: Model<NursingEntryDoc> =
  (mongoose.models.NursingEntry as Model<NursingEntryDoc>) ||
  mongoose.model<NursingEntryDoc>('NursingEntry', nursingEntrySchema, 'nursing_entries');
