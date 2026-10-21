import type { Actor } from './actor.helper.js';

/**
 * Object-level authorization (Auth Flow §5 step 4, SEC-08, R-09).
 * Given a resource's owning patient/user id and the requesting user, decide
 * access. Denials must be audited by the caller (possible IDOR attempt — R-08).
 */
export type ObjectOwnerInfo = {
  patientUserId?: string;
  patientId?: string;
  assignedDoctorIds?: string[];
  assignedNurseIds?: string[];
};

/** Alias of the shared Actor shape (single definition in actor.helper.ts). */
export type RequestingUser = Actor;

export type OwnershipDecision = { allowed: boolean; reason?: string };

export function assertObjectOwnership(
  owner: ObjectOwnerInfo,
  user: RequestingUser
): OwnershipDecision {
  // Own records.
  if (owner.patientUserId && owner.patientUserId === user.id) {
    return { allowed: true };
  }
  // PH-03+ deepens this with real assignment lookups (R-01…R-10).
  return {
    allowed: false,
    reason: 'not_own_record',
  };
}
