/**
 * Ownership middleware entry point — delegates to `helpers/ownership.helper.ts`.
 * Kept as the middleware-layer import path for services/middlewares.
 */
export {
  assertObjectOwnership,
  type ObjectOwnerInfo,
  type RequestingUser,
  type OwnershipDecision,
} from '../helpers/ownership.helper.js';
