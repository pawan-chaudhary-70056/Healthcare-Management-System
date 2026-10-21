import mongoose, { Schema, type Model } from 'mongoose';

/**
 * settings — per-facility policy overrides (EP-72, A-07). The policy loader
 * reads from here at runtime; admin edits are audited (PERM-62).
 */
export interface SettingsDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  value: unknown;
  updatedBy?: string;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsDoc>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: String },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ||
  mongoose.model<SettingsDoc>('Settings', settingsSchema, 'settings');

/**
 * break_glass_requests — emergency access (EP-76/77, AC-60/61): mandatory
 * reason, time-limited read-only scope, oversight alert, 72 h review window.
 */
export interface BreakGlassDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  requesterId: string;
  requesterRole: string;
  patientId: mongoose.Types.ObjectId;
  reason: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'REVIEWED';
  expiresAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const breakGlassSchema = new Schema<BreakGlassDoc>(
  {
    requesterId: { type: String, required: true, index: true },
    requesterRole: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    reason: { type: String, required: true, minlength: 10 },
    status: { type: String, enum: ['ACTIVE', 'REVOKED', 'EXPIRED', 'REVIEWED'], default: 'ACTIVE', required: true },
    // Time-limited: 60 min default window (configurable via policy).
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedBy: { type: String },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    reviewNotes: { type: String },
  },
  { timestamps: true }
);

breakGlassSchema.index({ status: 1, expiresAt: 1 });

export const BreakGlass: Model<BreakGlassDoc> =
  (mongoose.models.BreakGlass as Model<BreakGlassDoc>) ||
  mongoose.model<BreakGlassDoc>('BreakGlass', breakGlassSchema, 'break_glass_requests');
