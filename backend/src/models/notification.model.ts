import mongoose, { Schema, type Model } from 'mongoose';

/**
 * notifications — PH-03 minimal queue (Build TODOs PH-03; full outbox stack in
 * PH-08). Rows are inserted in the SAME transaction as the business write where
 * mandated (Database Design §6) and drained by a background processor.
 * Content limit (NFR-16 / AC-20 / AC-53): date/time/department only — never
 * diagnosis or clinical detail. Callers must pass pre-trimmed fields.
 */
export type NotificationChannel = 'in_app' | 'email' | 'sms';

export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED';

/** Events across all modules. External-channel payloads stay privacy-trimmed
 *  (NFR-16/AC-53): identifiers and categories only — never clinical detail. */
export type NotificationEvent =
  // Appointments (PH-03)
  | 'appointment.booked'
  | 'appointment.confirmed'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'
  | 'appointment.waitlist_offer'
  | 'appointment.reminder'
  // Laboratory (PH-05)
  | 'lab.critical_result'
  | 'lab.result_released'
  // Pharmacy (PH-06)
  | 'pharmacy.prescription_cancelled'
  | 'pharmacy.ready'
  // Billing (PH-07)
  | 'billing.invoice_issued'
  | 'billing.payment_received'
  // Platform (PH-08)
  | 'breakglass.requested'
  | 'account.password_reset';

export interface NotificationDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // recipient (patient or staff user)
  channel: NotificationChannel;
  event: NotificationEvent;
  payload: {
    appointmentId?: string;
    department?: string;
    slotStartIso?: string; // ISO 8601 UTC (A-01 wire format)
    slotEndIso?: string;
    orderId?: string;
    invoiceId?: string;
    testName?: string;
    [key: string]: string | undefined;
  };
  status: NotificationStatus;
  attempts: number;
  sentAt?: Date;
  lastError?: string;
  /** Appointment this notification belongs to (reminder de-dup key). */
  appointmentId?: mongoose.Types.ObjectId;
  /** Set once a reminder for the appointment has been sent (AC-20: once). */
  reminderSent?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: { type: String, enum: ['in_app', 'email', 'sms'], required: true },
    event: { type: String, required: true },
    payload: {
      appointmentId: { type: String },
      department: { type: String },
      slotStartIso: { type: String },
      slotEndIso: { type: String },
    },
    status: { type: String, enum: ['QUEUED', 'SENT', 'FAILED'], default: 'QUEUED', index: true },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date },
    lastError: { type: String },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ status: 1, createdAt: 1 });
// AC-20: at most ONE reminder per appointment per recipient. A PARTIAL index
// (not sparse!) is required: a sparse compound index would still index
// non-reminder docs that share userId+event, breaking one-notification-per-
// booking for the same patient (observed as E11000 → 409 on the second booking).
notificationSchema.index(
  { userId: 1, event: 1, appointmentId: 1 },
  { unique: true, partialFilterExpression: { event: 'appointment.reminder' }, name: 'uniq_reminder_per_appointment' }
);

export const Notification: Model<NotificationDoc> =
  (mongoose.models.Notification as Model<NotificationDoc>) ||
  mongoose.model<NotificationDoc>('Notification', notificationSchema, 'notifications');
