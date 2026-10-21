import mongoose, { Schema, type Model } from 'mongoose';
import { SCHEDULE_EXCEPTION_TYPE } from '../config/constants.js';

/**
 * doctor_schedules / schedule_exceptions — Database Design §3.2.
 * Slot computation input for PH-03 (slots generated on read; no slots collection).
 */
export interface DoctorScheduleDoc {
  _id: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  weekday: number; // 0–6 (Sunday=0)
  startTime: string; // 'HH:mm' facility-local (A-01)
  endTime: string;
  slotLengthMinutes: number;
  validFrom?: Date;
  validTo?: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleExceptionDoc {
  _id: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  date: string; // 'YYYY-MM-DD' facility-local
  type: (typeof SCHEDULE_EXCEPTION_TYPE)[number];
  customSlots?: Array<{ start: string; end: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const doctorScheduleSchema = new Schema<DoctorScheduleDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    weekday: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    slotLengthMinutes: { type: Number, min: 5, max: 240, required: true },
    validFrom: { type: Date },
    validTo: { type: Date },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

doctorScheduleSchema.index({ doctorId: 1, weekday: 1 });
doctorScheduleSchema.index({ departmentId: 1, active: 1 });

const scheduleExceptionSchema = new Schema<ScheduleExceptionDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    type: { type: String, enum: SCHEDULE_EXCEPTION_TYPE, required: true },
    customSlots: [
      {
        start: { type: String, required: true },
        end: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

scheduleExceptionSchema.index({ doctorId: 1, date: 1 }, { unique: true });

export const DoctorSchedule: Model<DoctorScheduleDoc> =
  (mongoose.models.DoctorSchedule as Model<DoctorScheduleDoc>) ||
  mongoose.model<DoctorScheduleDoc>('DoctorSchedule', doctorScheduleSchema);

export const ScheduleException: Model<ScheduleExceptionDoc> =
  (mongoose.models.ScheduleException as Model<ScheduleExceptionDoc>) ||
  mongoose.model<ScheduleExceptionDoc>('ScheduleException', scheduleExceptionSchema);
