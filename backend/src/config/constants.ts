/**
 * Canonical constants — single source of truth.
 * Status values: docs/00-PROJECT-FOUNDATION/02-PROJECT-GLOSSARY.md §13 (do NOT rename).
 * Permissions:   docs/02-USER-ACCESS/01-ROLES-AND-PERMISSIONS.md §4 (PERM-01..68).
 * No magic strings elsewhere in the codebase.
 */

// ---------------------------------------------------------------------------
// Roles (A-05 — fixed at deployment)
// ---------------------------------------------------------------------------
export const ROLES = [
  'admin',
  'receptionist',
  'doctor',
  'nurse',
  'lab_tech',
  'pharmacist',
  'accountant',
  'patient',
] as const;
export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// Canonical status vocabularies (Glossary §13)
// ---------------------------------------------------------------------------
export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'LOCKED', 'PENDING_MFA_SETUP'] as const;
export const APPOINTMENT_STATUS = [
  'REQUESTED',
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_CONSULTATION',
  'COMPLETED',
  'CANCELLED',
  'RESCHEDULED',
  'NO_SHOW',
] as const;
export const INVOICE_STATUS = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'REFUNDED',
  'CANCELLED',
] as const;
export const LAB_ORDER_STATUS = [
  'ORDERED',
  'SPECIMEN_COLLECTED',
  'IN_PROCESS',
  'RESULT_ENTERED',
  'VERIFIED',
  'RELEASED',
  'AMENDED',
  'CANCELLED',
] as const;
export const PRESCRIPTION_STATUS = [
  'ACTIVE',
  'PARTIALLY_DISPENSED',
  'FULLY_DISPENSED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUS)[number];

// PH-01 reference-data statuses
export const DEPARTMENT_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export const SCHEDULE_EXCEPTION_TYPE = ['CLOSED', 'CUSTOM'] as const;
export const BATCH_STATUS = ['AVAILABLE', 'QUARANTINED', 'RECALLED', 'EXPIRED'] as const;

// ---------------------------------------------------------------------------
// Permission catalog — docs/02-USER-ACCESS/01-ROLES-AND-PERMISSIONS.md §4
// Implementation source of truth. Do not invent permission strings.
// ---------------------------------------------------------------------------
export const PERMISSIONS = {
  // 4.1 Patient Management
  'patient.create': ['admin', 'receptionist'], // PERM-01
  'patient.read.own': ['patient'], // PERM-02
  'patient.read.assigned': ['doctor', 'nurse'], // PERM-03
  'patient.read.all': ['admin'], // PERM-04 (demographics only)
  'patient.update': ['admin', 'receptionist'], // PERM-05
  'patient.update.own': ['patient'], // PERM-06
  'patient.consent.manage': ['admin', 'receptionist', 'patient'], // PERM-07

  // 4.2 Appointments
  'appointment.create.any': ['admin', 'receptionist'], // PERM-10
  'appointment.create.own': ['patient'], // PERM-11
  'appointment.reschedule': ['admin', 'receptionist', 'patient'], // PERM-12 (patient: own within policy)
  'appointment.cancel': ['admin', 'receptionist', 'patient'], // PERM-13 (patient: own within policy)
  'appointment.checkin': ['receptionist'], // PERM-14
  'appointment.queue.manage': ['receptionist'], // PERM-15
  'appointment.read.own-schedule': ['doctor'], // PERM-16
  'appointment.read.assigned': ['nurse'], // PERM-17

  // 4.3 Clinical / EMR
  'encounter.create': ['doctor'], // PERM-20
  'emr.write': ['doctor'], // PERM-21
  'emr.amend': ['doctor'], // PERM-22
  'emr.read.assigned': ['doctor', 'nurse'], // PERM-23
  'nursing.entry.create': ['nurse'], // PERM-24
  'emr.read.released.own': ['patient'], // PERM-25

  // 4.4 Laboratory
  'lab.order.create': ['doctor'], // PERM-30
  'lab.specimen.record': ['lab_tech'], // PERM-31
  'lab.result.enter': ['lab_tech'], // PERM-32
  'lab.result.verify': ['lab_tech'], // PERM-33
  'lab.result.release': ['lab_tech'], // PERM-34
  'lab.result.read.assigned': ['doctor'], // PERM-35
  'lab.result.read.released.own': ['patient'], // PERM-36

  // 4.5 Pharmacy
  'prescription.create': ['doctor'], // PERM-40
  'prescription.validate': ['pharmacist'], // PERM-41
  'prescription.dispense': ['pharmacist'], // PERM-42
  'pharmacy.inventory.manage': ['pharmacist'], // PERM-43
  'pharmacy.stock.adjust': ['pharmacist'], // PERM-44 (audited)
  'prescription.read.own': ['patient'], // PERM-45

  // 4.6 Billing & Finance
  'invoice.create': ['accountant'], // PERM-50
  'invoice.read.any': ['accountant', 'admin'], // PERM-51
  'invoice.read.own': ['patient'], // PERM-52
  'payment.record': ['accountant', 'receptionist'], // PERM-53
  'payment.refund.approve': ['accountant', 'admin'], // PERM-54
  'invoice.amend': ['accountant'], // PERM-55

  // 4.7 Administration, Audit & Security
  'user.manage': ['admin'], // PERM-60
  'role.assign': ['admin'], // PERM-61
  'settings.manage': ['admin'], // PERM-62
  'audit.read.all': ['admin'], // PERM-63
  'audit.read.own-events': ['doctor'], // PERM-64
  'audit.read.financial': ['accountant'], // PERM-65
  'breakglass.use': ['doctor', 'nurse'], // PERM-66 (facility list)
  'breakglass.review': ['admin'], // PERM-67
  'backup.manage': ['admin'], // PERM-68
} as const satisfies Record<string, readonly Role[]>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Permissions granted to a role (derived from the catalog — no separate map to drift). */
export function permissionsForRole(role: Role): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => (PERMISSIONS[key] as readonly Role[]).includes(role));
}

// ---------------------------------------------------------------------------
// Error codes — docs/06-API-AND-ERRORS/02-ERROR-HANDLING-AND-VALIDATION.md §3
// ---------------------------------------------------------------------------
export const ERROR_CODES = {
  // Auth & access
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  MFA_REQUIRED: 401,
  ACCOUNT_LOCKED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  // Validation & business rules
  VALIDATION_ERROR: 422,
  INVALID_TRANSITION: 422,
  POLICY_WINDOW: 422,
  MISSING_FIELD: 422,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  DUPLICATE_REQUEST: 409,
  // Appointments
  SLOT_TAKEN: 409,
  SLOT_UNAVAILABLE: 422,
  // Clinical / Lab / Pharmacy
  ENCOUNTER_NOT_OPEN: 422,
  RECORD_FINALIZED: 422,
  RESULT_NOT_VERIFIED: 422,
  CRITICAL_ACK_REQUIRED: 422,
  PRESCRIPTION_INVALID: 422,
  BATCH_EXPIRED: 422,
  INSUFFICIENT_STOCK: 422,
  BATCH_QUARANTINED: 422,
  // Billing
  INVOICE_ISSUED: 422,
  PAYMENT_EXCEEDS_BALANCE: 422,
  GATEWAY_ERROR: 502,
  WEBHOOK_SIGNATURE_INVALID: 400,
  REFUND_NOT_AUTHORIZED: 403,
  // Generic
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

// ---------------------------------------------------------------------------
// Audit actions (module-scoped) — FR-54 baseline
// ---------------------------------------------------------------------------
export const AUDIT_ACTIONS = {
  USER_LOGIN: 'auth.login',
  USER_LOGIN_FAILED: 'auth.login_failed',
  USER_LOGOUT: 'auth.logout',
  USER_REGISTER: 'auth.register',
  MFA_ENROLL: 'auth.mfa_enroll',
  MFA_VERIFY: 'auth.mfa_verify',
  MFA_VERIFY_FAILED: 'auth.mfa_verify_failed',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_SUSPEND: 'user.suspend',
  ROLE_ASSIGN: 'user.role_assign',
  DEPARTMENT_CREATE: 'admin.department_create',
  DEPARTMENT_UPDATE: 'admin.department_update',
  SCHEDULE_CREATE: 'admin.schedule_create',
  SCHEDULE_UPDATE: 'admin.schedule_update',
  SCHEDULE_EXCEPTION_CREATE: 'admin.schedule_exception_create',
  SCHEDULE_EXCEPTION_DELETE: 'admin.schedule_exception_delete',
  ACCESS_DENIED: 'security.access_denied',
  // PH-03 — patients (EP-10..14)
  PATIENT_CREATE: 'patient.create',
  PATIENT_UPDATE: 'patient.update',
  PATIENT_READ_OTHER: 'patient.read_other',
  CONSENT_UPDATE: 'patient.consent_update',
  // PH-03 — appointments (EP-20..27, T-01..T-11)
  APPOINTMENT_BOOK: 'appointment.book',
  APPOINTMENT_SCHEDULE: 'appointment.schedule',
  APPOINTMENT_CONFIRM: 'appointment.confirm',
  APPOINTMENT_RESCHEDULE: 'appointment.reschedule',
  APPOINTMENT_CANCEL: 'appointment.cancel',
  APPOINTMENT_CHECKIN: 'appointment.checkin',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',
  APPOINTMENT_START: 'appointment.start',
  APPOINTMENT_COMPLETE: 'appointment.complete',
  APPOINTMENT_INVALID_TRANSITION: 'appointment.invalid_transition',
  WAITLIST_JOIN: 'appointment.waitlist_join',
  WAITLIST_LEAVE: 'appointment.waitlist_leave',
  WAITLIST_OFFER: 'appointment.waitlist_offer',
  // PH-04 — clinical & nursing (EP-30..38)
  ENCOUNTER_CREATE: 'encounter.create',
  ENCOUNTER_FINALIZE: 'encounter.finalize',
  EMR_WRITE: 'emr.write',
  EMR_FINALIZE: 'emr.finalize',
  EMR_AMEND: 'emr.amend',
  EMR_RELEASE: 'emr.release',
  PRESCRIPTION_CREATE: 'prescription.create',
  PRESCRIPTION_CANCEL: 'prescription.cancel',
  NURSING_ENTRY_CREATE: 'nursing.entry_create',
  // PH-05 — laboratory (EP-40..46)
  LAB_ORDER_CREATE: 'lab.order_create',
  LAB_SPECIMEN_RECORD: 'lab.specimen_record',
  LAB_RESULT_ENTER: 'lab.result_enter',
  LAB_RESULT_VERIFY: 'lab.result_verify',
  LAB_CRITICAL_ALERT: 'lab.critical_alert',
  LAB_CRITICAL_ACK: 'lab.critical_ack',
  LAB_RESULT_RELEASE: 'lab.result_release',
  LAB_RESULT_AMEND: 'lab.result_amend',
  LAB_ORDER_CANCEL: 'lab.order_cancel',
  // PH-06 — pharmacy (EP-50..55)
  PRESCRIPTION_VALIDATE: 'prescription.validate',
  PRESCRIPTION_DISPENSE: 'prescription.dispense',
  INVENTORY_RECEIVE: 'inventory.receive',
  INVENTORY_ADJUST: 'inventory.adjust',
  BATCH_QUARANTINE: 'inventory.quarantine',
  BATCH_RECALL: 'inventory.recall',
  // PH-07 — billing (EP-60..67)
  INVOICE_CREATE: 'invoice.create',
  INVOICE_ISSUE: 'invoice.issue',
  PAYMENT_RECORD: 'payment.record',
  PAYMENT_WEBHOOK: 'payment.webhook',
  REFUND_APPROVE: 'payment.refund_approve',
  DISCOUNT_APPLY: 'invoice.discount_apply',
  // PH-08 — platform (EP-70..77)
  BREAKGLASS_REQUEST: 'breakglass.request',
  BREAKGLASS_REVOKE: 'breakglass.revoke',
  BREAKGLASS_REVIEW: 'breakglass.review',
  POLICY_UPDATE: 'admin.policy_update',
  BACKUP_TRIGGER: 'admin.backup_trigger',
} as const;
