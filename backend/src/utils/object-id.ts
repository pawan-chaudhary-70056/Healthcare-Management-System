import { Types } from 'mongoose';
import { ValidationError } from '../errors/app-error.js';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Parse a client-supplied id (query string / path param) into an ObjectId.
 *
 * SEC-17/SEC-19: a malformed or operator-shaped value must surface as a
 * 422 VALIDATION_ERROR via the standard envelope — never an unhandled Mongoose
 * CastError that leaks a 500. `Types.ObjectId.isValid` alone is not enough
 * (it accepts any 12-byte string), so the canonical 24-hex form is enforced.
 */
export function asObjectId(value: unknown, field = 'id'): Types.ObjectId {
  if (typeof value !== 'string' || !OBJECT_ID_RE.test(value)) {
    throw new ValidationError([{ field, issue: 'must be a valid id' }]);
  }
  return new Types.ObjectId(value);
}

/** Optional variant: `undefined` for empty input, validated ObjectId otherwise. */
export function asOptionalObjectId(value: unknown, field = 'id'): Types.ObjectId | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return asObjectId(value, field);
}
