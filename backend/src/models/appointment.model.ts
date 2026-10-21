import mongoose, { Schema, type Model } from 'mongoose';
import { APPOINTMENT_STATUS } from '../config/constants.js';

/**
 * appointments — Database Design §3.4. Statuses are canonical glossary strings.
 * Slot values are UTC DateTimes computed from facility-local schedule templates.
 */
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number];

export interface StatusHistoryEntry {
  from: AppointmentStatus | null;
  to: AppointmentStatus;
  by: string; // user id
  byRole: string;
  at: Date;
  reason?: string;
}

export interface AppointmentDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  slot: { start: Date; end: Date };
  serviceType: string;
  reasonForVisit?: string;
  status: AppointmentStatus;
  /** True while this appointment occupies its slot (booking → terminal/reschedule).
   *  Backs the partial unique index that makes double booking impossible at
   *  commit time (AC-15) — a read-then-insert check alone is racy. */
  activeSlot: boolean;
  idempotencyKey?: string;
  bookedBy: { userId: string; role: string };
  statusHistory: StatusHistoryEntry[];
  appointmentNo?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<AppointmentDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    slot: {
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    serviceType: { type: String, default: 'consultation' },
    reasonForVisit: { type: String, select: false }, // private (NFR-16)
    status: { type: String, enum: APPOINTMENT_STATUS, required: true },
    // CRITICAL (AC-15): MUST be declared in the schema — Mongoose strips
    // undeclared fields, and without persisted values the partial unique
    // index `uniq_active_slot` matches nothing, making double booking possible
    // under concurrency. Declared here, booking sets true and terminal/
    // RESCHEDULED transitions flip it false (freeing the slot).
    activeSlot: { type: Boolean, default: false },
    idempotencyKey: { type: String }, // sparse unique via partial index below
    bookedBy: {
      userId: { type: String, required: true },
      role: { type: String, required: true },
    },
    statusHistory: [
      {
        from: { type: String },
        to: { type: String, required: true },
        by: { type: String, required: true },
        byRole: { type: String, required: true },
        at: { type: Date, default: () => new Date(), required: true },
        reason: { type: String },
      },
    ],
    appointmentNo: { type: String },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, 'slot.start': 1 });
appointmentSchema.index({ patientId: 1, 'slot.start': -1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true }
);
// Double-booking guard: at most one slot-occupying appointment per doctor/slot.
// Uniqueness is enforced at transaction commit (AC-15, NFR-05).
appointmentSchema.index(
  { doctorId: 1, 'slot.start': 1 },
  { unique: true, partialFilterExpression: { activeSlot: true }, name: 'uniq_active_slot' }
);

export const Appointment: Model<AppointmentDoc> =
  (mongoose.models.Appointment as Model<AppointmentDoc>) ||
  mongoose.model<AppointmentDoc>('Appointment', appointmentSchema, 'appointments');

// ---------------------------------------------------------------------------
// queue_tokens — check-in order per doctor/department day (§2 collections)
// ---------------------------------------------------------------------------

export interface QueueTokenDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  appointmentId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  tokenNo: number;
  date: string; // facility-local 'YYYY-MM-DD'
  status: 'WAITING' | 'CALLED' | 'SERVED';
  issuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const queueTokenSchema = new Schema<QueueTokenDoc>(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    tokenNo: { type: Number, required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ['WAITING', 'CALLED', 'SERVED'], default: 'WAITING' },
    issuedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

queueTokenSchema.index({ doctorId: 1, date: 1, tokenNo: 1 }, { unique: true });
queueTokenSchema.index({ departmentId: 1, date: 1, tokenNo: 1 });

export const QueueToken: Model<QueueTokenDoc> =
  (mongoose.models.QueueToken as Model<QueueTokenDoc>) ||
  mongoose.model<QueueTokenDoc>('QueueToken', queueTokenSchema, 'queue_tokens');

// ---------------------------------------------------------------------------
// waitlist — join/offer/expire (§2 collections, workflow §5)
// ---------------------------------------------------------------------------

export type WaitlistStatus = 'WAITING' | 'OFFERED' | 'FULFILLED' | 'EXPIRED' | 'LEFT';

export interface WaitlistEntryDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  date: string; // facility-local 'YYYY-MM-DD'
  joinedAt: Date;
  status: WaitlistStatus;
  offeredSlotStart?: Date;
  offerExpiresAt?: Date;
  resolvedAt?: Date;
  priority: number; // lower = earlier offer per policy
  createdAt: Date;
  updatedAt: Date;
}

const waitlistSchema = new Schema<WaitlistEntryDoc>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    date: { type: String, required: true },
    joinedAt: { type: Date, default: () => new Date(), required: true },
    status: { type: String, enum: ['WAITING', 'OFFERED', 'FULFILLED', 'EXPIRED', 'LEFT'], default: 'WAITING' },
    offeredSlotStart: { type: Date },
    offerExpiresAt: { type: Date },
    resolvedAt: { type: Date },
    priority: { type: Number, default: 0 },
  },
  { timestamps: true }
);

waitlistSchema.index({ doctorId: 1, date: 1, status: 1, priority: 1, joinedAt: 1 });
waitlistSchema.index({ patientId: 1, status: 1 });

export const WaitlistEntry: Model<WaitlistEntryDoc> =
  (mongoose.models.WaitlistEntry as Model<WaitlistEntryDoc>) ||
  mongoose.model<WaitlistEntryDoc>('WaitlistEntry', waitlistSchema, 'waitlist');
