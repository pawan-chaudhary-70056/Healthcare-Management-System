import mongoose, { Schema, type Model } from 'mongoose';
import { ROLES, type PermissionKey, type Role } from '../config/constants.js';

/**
 * roles — role → permission keys (seeded from the catalog; never invented).
 * docs/02-USER-ACCESS/01-ROLES-AND-PERMISSIONS.md §4
 */
export interface RoleDoc {
  _id: mongoose.Types.ObjectId;
  name: Role;
  permissions: PermissionKey[];
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<RoleDoc>(
  {
    name: { type: String, enum: ROLES, required: true },
    permissions: { type: [String], required: true },
  },
  { timestamps: true }
);

roleSchema.index({ name: 1 }, { unique: true });

export const RoleModel: Model<RoleDoc> =
  (mongoose.models.Role as Model<RoleDoc>) || mongoose.model<RoleDoc>('Role', roleSchema);
