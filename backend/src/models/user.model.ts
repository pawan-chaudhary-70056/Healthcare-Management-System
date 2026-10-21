import mongoose, { Schema, type Model } from 'mongoose';
import { ROLES, USER_STATUS, type Role } from '../config/constants.js';

/**
 * users — docs/04-SYSTEM-DESIGN/02-DATABASE-DESIGN.md §3.1
 * passwordHash / mfa.secretEncrypted are select:false (never returned by any API).
 */
export interface UserDoc {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  role: Role;
  status: (typeof USER_STATUS)[number];
  mfa: { enabled: boolean; secretEncrypted?: string };
  failedLogins: number;
  lockedUntil?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  staffProfile?: { department?: string; specialties?: string[]; fullName?: string };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    status: {
      type: String,
      enum: USER_STATUS,
      default: 'ACTIVE',
      required: true,
    },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEncrypted: { type: String, select: false },
    },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    staffProfile: {
      department: { type: String },
      specialties: { type: [String] },
      fullName: { type: String },
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) || mongoose.model<UserDoc>('User', userSchema);
