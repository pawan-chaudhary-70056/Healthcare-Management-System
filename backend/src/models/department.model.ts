import mongoose, { Schema, type Model } from 'mongoose';

/**
 * departments — docs/04-SYSTEM-DESIGN/02-DATABASE-DESIGN.md §3.2
 */
export interface DepartmentDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  publicVisible: boolean;
  active: boolean;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<DepartmentDoc>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    publicVisible: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true }
);

departmentSchema.index({ name: 1 }, { unique: true });
departmentSchema.index({ active: 1, orderIndex: 1 });

export const Department: Model<DepartmentDoc> =
  (mongoose.models.Department as Model<DepartmentDoc>) ||
  mongoose.model<DepartmentDoc>('Department', departmentSchema);
