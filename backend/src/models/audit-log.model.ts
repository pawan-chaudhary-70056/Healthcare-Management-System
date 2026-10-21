import mongoose, { Schema, type Model } from 'mongoose';

/**
 * audit_log — append-only (C-03). Never updated or deleted by application code.
 * Schema: docs/04-SYSTEM-DESIGN/02-DATABASE-DESIGN.md §3.11
 */
export interface AuditEntry {
  at: Date;
  actorId?: mongoose.Types.ObjectId;
  actorRole?: string;
  action: string;
  module: string;
  resourceType?: string;
  resourceId?: string;
  patientId?: mongoose.Types.ObjectId;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

const auditSchema = new Schema<AuditEntry>(
  {
    at: { type: Date, default: () => new Date(), index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String },
    action: { type: String, required: true },
    module: { type: String, required: true },
    resourceType: { type: String },
    resourceId: { type: String },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    outcome: { type: String, enum: ['SUCCESS', 'DENIED', 'FAILED'], required: true },
    ip: { type: String },
    userAgent: { type: String },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

auditSchema.index({ at: -1 });
auditSchema.index({ actorId: 1, at: -1 });
auditSchema.index({ patientId: 1, at: -1 });
auditSchema.index({ module: 1, at: -1 });

// MongoDB 5+ collection-level protection is configured by ops (validator + no-update
// role). Application layer enforces append-only: only create is ever exposed.
export const AuditLog =
  (mongoose.models.AuditLog as Model<AuditEntry>) ||
  mongoose.model<AuditEntry>('AuditLog', auditSchema, 'audit_log');
