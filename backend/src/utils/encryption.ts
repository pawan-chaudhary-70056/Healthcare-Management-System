import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM encryption for TOTP secrets at rest (mfa.secretEncrypted —
 * Database Design §3.1: never returned by any API).
 */
function key(): Buffer {
  return createHash('sha256').update(env.MFA_ENCRYPTION_KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(packed: string): string {
  const [ivB64, tagB64, dataB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
