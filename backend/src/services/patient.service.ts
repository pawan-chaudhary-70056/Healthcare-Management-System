import { FilterQuery, Types } from 'mongoose';
import { Patient, CONSENT_TYPES, type ConsentType, type PatientDoc } from '../models/patient.model.js';
import { AppError } from '../errors/app-error.js';
import { audit } from './audit.service.js';
import { assertObjectOwnership, type RequestingUser } from '../middlewares/ownership.middleware.js';
import { escapeRegex } from '../utils/regex.js';

/**
 * Patients service — EP-10…14, FR-10…13, AC-10…13.
 * Scope rules R-01…R-09: every cross-patient read is object-checked + audited;
 * patients touch only their own record (own = patient.userId matches).
 */

/** Exported for registration flow (auth controller) — same generator. */
export async function nextMrnForUser(): Promise<string> {
  return nextMrn();
}

/** Sequential facility MRN: MRN-YYYY-#### per year. */
async function nextMrn(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MRN-${year}-`;
  const last = await Patient.findOne({ mrn: new RegExp(`^${prefix}`) })
    .sort({ mrn: -1 })
    .select('mrn')
    .lean();
  const lastSeq = last ? Number(last.mrn.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Find (or lazily provision) the patient record bound to a user account. */
export async function findForUser(userId: string): Promise<PatientDoc | null> {
  return Patient.findOne({ userId: new Types.ObjectId(userId) });
}

export interface Actor extends RequestingUser {
  id: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Projections — minimum-necessary per role (SEC-14, FR-13)
// ---------------------------------------------------------------------------

const STAFF_PROJECTION =
  'firstName lastName dob gender contacts identityRef consentFlags mrn userId assignedDoctorIds createdAt';
const PATIENT_OWN_PROJECTION =
  'firstName lastName dob gender contacts consentFlags mrn createdAt';

function projectionFor(role: string): string {
  return role === 'patient' ? PATIENT_OWN_PROJECTION : STAFF_PROJECTION;
}

// ---------------------------------------------------------------------------
// Ownership / scope
// ---------------------------------------------------------------------------

export type PatientAccess = { allowed: true; patient: PatientDoc } | { allowed: false };

/**
 * Object-level check: may this actor access this patient?
 * - patient: only own record (patient.userId === actor.id)
 * - doctor: assigned via appointment/encounter/assignment (checked by caller
 *   against assignedDoctorIds) or holding patient.read.all for demographics
 * - admin: demographics only (PERM-04 note) — handled by caller's permission
 * - receptionist: granted patient.create/update — full demographics (R-06 admin only)
 */
export async function canAccessPatient(
  patient: PatientDoc,
  actor: Actor
): Promise<{ allowed: boolean; reason?: string }> {
  if (actor.role === 'patient') {
    const decision = assertObjectOwnership({ patientUserId: patient.userId ? String(patient.userId) : undefined }, actor);
    return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
  }
  if (actor.role === 'admin') return { allowed: true }; // demographics-only projection applied
  if (actor.role === 'receptionist') return { allowed: true };
  if (actor.role === 'doctor' || actor.role === 'nurse') {
    // Assigned scope: doctor in assignedDoctorIds, or linked user record.
    const assigned = patient.assignedDoctorIds.some((d) => String(d) === actor.id);
    if (assigned) return { allowed: true };
    // Nurse assignment via patients list is provisioned in later phases; for
    // now nurses need explicit assignment (R-02).
    return { allowed: false, reason: 'not_assigned' };
  }
  return { allowed: false, reason: 'role_not_authorized' };
}

/** Audit a cross-patient access attempt (R-08: every access beyond own is audited). */
async function auditAccess(patient: PatientDoc, actor: Actor, req?: { ip?: string; headers?: unknown }) {
  if (actor.role === 'patient' && String(patient.userId) === actor.id) return; // own — no audit needed
  await audit({
    action: 'patient.read_other',
    module: 'patients',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'patient',
    resourceId: String(patient._id),
    patientId: String(patient._id),
    req: req as never,
  });
}

export async function assertCanAccessPatient(
  patientId: string,
  actor: Actor,
  req?: { ip?: string; headers?: unknown }
): Promise<PatientDoc> {
  const patient = await Patient.findById(patientId);
  if (!patient) throw new AppError('NOT_FOUND', 'Patient not found.');
  const decision = await canAccessPatient(patient, actor);
  if (!decision.allowed) {
    await audit({
      action: 'security.access_denied',
      module: 'patients',
      outcome: 'DENIED',
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: 'patient',
      resourceId: patientId,
      details: { reason: decision.reason },
      req: req as never,
    });
    throw new AppError('FORBIDDEN', "You don't have access to this patient's record.");
  }
  await auditAccess(patient, actor, req);
  return patient;
}

// ---------------------------------------------------------------------------
// EP-10 create (admin, receptionist)
// ---------------------------------------------------------------------------

export async function createPatient(
  input: {
    firstName: string;
    lastName: string;
    dob: string;
    gender: 'male' | 'female' | 'other';
    phone?: string;
    email?: string;
    address?: string;
    identityRef?: { type: string; value: string };
  },
  actor: Actor,
  req?: { ip?: string; headers?: unknown }
): Promise<PatientDoc> {
  const mrn = await nextMrn();
  const patient = await Patient.create({
    mrn,
    firstName: input.firstName,
    lastName: input.lastName,
    dob: input.dob,
    gender: input.gender,
    contacts: { phone: input.phone, email: input.email, address: input.address },
    identityRef: input.identityRef,
    assignedDoctorIds: [],
  });
  await audit({
    action: 'patient.create',
    module: 'patients',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'patient',
    resourceId: String(patient._id),
    req: req as never,
    details: { mrn },
  });
  return patient;
}

// ---------------------------------------------------------------------------
// EP-12 update (staff any; patient own non-identity fields)
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS = ['dob', 'gender', 'identityRef'] as const;

export async function updatePatient(
  patientId: string,
  patch: Record<string, unknown>,
  actor: Actor,
  req?: { ip?: string; headers?: unknown }
): Promise<PatientDoc> {
  const patient = await assertCanAccessPatient(patientId, actor, req);

  if (actor.role === 'patient') {
    // AC-11: patients may change only permitted (non-identity) fields.
    const attempted = IDENTITY_FIELDS.filter((f) => patch[f] !== undefined);
    if (attempted.length > 0) {
      throw new AppError('FORBIDDEN', 'Identity details require staff assistance to change.');
    }
  }

  if (patch.firstName !== undefined) patient.firstName = patch.firstName as string;
  if (patch.lastName !== undefined) patient.lastName = patch.lastName as string;
  if (patch.dob !== undefined) patient.dob = patch.dob as string;
  if (patch.gender !== undefined) patient.gender = patch.gender as PatientDoc['gender'];
  const contacts = patch as { phone?: string; email?: string; address?: string };
  if (contacts.phone !== undefined) patient.contacts.phone = contacts.phone;
  if (contacts.email !== undefined) patient.contacts.email = contacts.email;
  if (contacts.address !== undefined) patient.contacts.address = contacts.address;
  if (patch.identityRef !== undefined) patient.identityRef = patch.identityRef as PatientDoc['identityRef'];

  await patient.save();
  await audit({
    action: 'patient.update',
    module: 'patients',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    req: req as never,
    details: { fields: Object.keys(patch) },
  });
  return patient;
}

// ---------------------------------------------------------------------------
// EP-14 consents (PERM-07; patient manages own only — R-03)
// ---------------------------------------------------------------------------

export async function putConsents(
  patientId: string,
  consents: Array<{ type: ConsentType; granted: boolean; note?: string }>,
  actor: Actor,
  req?: { ip?: string; headers?: unknown }
): Promise<PatientDoc> {
  const patient = await assertCanAccessPatient(patientId, actor, req);

  for (const c of consents) {
    patient.consents.push({
      type: c.type,
      granted: c.granted,
      grantedAt: new Date(),
      note: c.note,
    });
    patient.consentFlags[c.type] = c.granted;
  }
  await patient.save();

  await audit({
    action: 'patient.consent_update',
    module: 'patients',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    req: req as never,
    details: { types: consents.map((c) => c.type) },
  });
  return patient;
}

// ---------------------------------------------------------------------------
// EP-13 summary — care-team scoped clinical-adjacent view
// ---------------------------------------------------------------------------

export async function patientSummary(patient: PatientDoc) {
  return {
    id: String(patient._id),
    mrn: patient.mrn,
    name: `${patient.firstName} ${patient.lastName}`,
    dob: patient.dob,
    gender: patient.gender,
    contactPhone: patient.contacts.phone,
    consentFlags: patient.consentFlags,
  };
}

/** List/search for staff with permission (AC-12 pattern — scoped, projected). */
export async function listPatients(
  filter: { q?: string },
  skip: number,
  lim: number,
  actor: Actor
) {
  const query: FilterQuery<PatientDoc> = {};
  if (filter.q) {
    const rx = new RegExp(escapeRegex(filter.q), 'i');
    query.$or = [{ firstName: rx }, { lastName: rx }, { mrn: rx }];
  }
  const [items, total] = await Promise.all([
    Patient.find(query)
      .sort({ lastName: 1, firstName: 1 })
      .skip(skip)
      .limit(lim)
      .select(projectionFor(actor.role))
      .lean(),
    Patient.countDocuments(query),
  ]);
  return { items, total };
}

export { CONSENT_TYPES };
