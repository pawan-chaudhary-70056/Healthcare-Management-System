import { totpAt } from '../src/core/utils/totp.js';

/**
 * Dev/ops utility: print the current TOTP code for a base32 secret.
 * Usage: npm run totp -- <base32secret>
 * Used to verify MFA enrollment without a phone (never needed in production).
 */
const secret = process.argv[2];
if (!secret) {
  // eslint-disable-next-line no-console
  console.error('usage: tsx scripts/totp-code.ts <base32secret>');
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(totpAt(secret, Date.now()));
