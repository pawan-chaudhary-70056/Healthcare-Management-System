import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) — HMAC-SHA1, 6 digits, 30 s step — for EP-07 MFA (SEC-04).
 * Implemented with Node's built-in crypto only (no new dependencies —
 * Frameworks doc: no libraries for convenience alone).
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return base32Encode(buf);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpAt(secret: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/**
 * Verify with ±1 step window drift tolerance and constant-time comparison.
 */
export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const now = Date.now();
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = totpAt(secret, now + drift * 30_000);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUri(secret: string, email: string, issuer = 'HMS'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    email
  )}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
