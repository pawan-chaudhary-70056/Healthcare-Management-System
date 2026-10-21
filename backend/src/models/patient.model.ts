import mongoose, { Schema, type Model } from 'mongoose';

/**
 * patients — Database Design §3.3.
 * userId links the patient record to a user account (1─1, optional for staff-
 * created records before the patient registers). consentFlags mirror the
 * consents subcollection head values for quick reads.
 */
export const CONSENT_TYPES = ['privacy_notice', 'share_with_lab', 'share_with_pharmacy'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface ConsentRecord {
  type: ConsentType;
  granted: boolean;
  grantedAt: Date;
  note?: string;
}

export interface PatientDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string; // 'YYYY-MM-DD'
  gender: 'male' | 'female' | 'other';
  contacts: { phone?: string; email?: string; address?: string };
  identityRef?: { type: string; value: string };
  consentFlags: Partial<Record<ConsentType, boolean>>;
  consents: ConsentRecord[];
  assignedDoctorIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const consentSchema = new Schema(
  {
    type: { type: String, enum: CONSENT_TYPES, required: true },
    granted: { type: Boolean, required: true },
    grantedAt: { type: Date, default: () => new Date(), required: true },
    note: { type: String },
  },
  { _id: false }
);

const patientSchema = new Schema<PatientDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    mrn: { type: String, required: true, unique: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dob: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    contacts: {
      phone: { type: String },
      email: { type: String },
      address: { type: String },
    },
    identityRef: {
      type: { type: String },
      value: { type: String },
    },
    consentFlags: {
      privacy_notice: { type: Boolean, default: false },
      share_with_lab: { type: Boolean, default: false },
      share_with_pharmacy: { type: Boolean, default: false },
    },
    consents: { type: [consentSchema], default: [] },
    assignedDoctorIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

patientSchema.index({ phone: 1 });
patientSchema.index({ lastName: 1, firstName: 1 });

export const Patient: Model<PatientDoc> =
  (mongoose.models.Patient as Model<PatientDoc>) ||
  mongoose.model<PatientDoc>('Patient', patientSchema, 'patients');
