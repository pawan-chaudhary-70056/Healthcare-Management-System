import { describe, it, expect } from 'vitest';
import { generateTotpSecret, totpAt, verifyTotp, base32Decode, base32Encode } from '../../src/utils/totp.js';

describe('TOTP (RFC 6238)', () => {
  it('round-trips base32 encoding', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('is deterministic for the same secret+time', () => {
    const secret = generateTotpSecret();
    const t = 1_700_000_000_000;
    expect(totpAt(secret, t)).toBe(totpAt(secret, t));
  });

  it('accepts the current code', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret, Date.now());
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('accepts a code from the previous step (drift tolerance)', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret, Date.now() - 30_000);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rejects a code two steps away', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret, Date.now() - 90_000);
    expect(verifyTotp(secret, code)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });
});
