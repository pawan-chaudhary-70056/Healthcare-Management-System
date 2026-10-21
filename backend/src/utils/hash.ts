import argon2 from 'argon2';

/**
 * Password hashing — Argon2id only (C-07).
 */
const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP baseline)
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

export function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  return argon2.verify(hashValue, plain);
}

/**
 * Constant-time-ish dummy verify for anti-enumeration (SEC-02):
 * when the account does not exist we still perform a hash comparison so the
 * response time matches the "wrong password" path.
 */
export async function dummyVerify(): Promise<void> {
  try {
    await argon2.verify(DUMMY_HASH, 'dummy-password-for-timing');
  } catch {
    // swallow — purpose is equal-time failure path only
  }
}

// Real Argon2id hash of 'dummy-password-for-timing'
export const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$VLXSPpRwk8CMr5dW0MbAGQ$+Fc4yJ1juNVQSjJ8GJ/F3+vhKYmSs2Rh2aozbQmq5+o';
