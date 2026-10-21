import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * tests/security — CSRF posture (Testing Strategy §3, SEC: cross-site writes).
 *
 * Cookie-based sessions with no CSRF token are safe here because two layers
 * hold:
 *   1. The session cookie is `SameSite=Lax`, so a cross-site POST/PUT/DELETE
 *      navigation does not carry the session in the first place.
 *   2. Writes are JSON-only — a browser's "simple" cross-site forms
 *      (`application/x-www-form-urlencoded`, `multipart/form-data`,
 *      `text/plain`) are not parsed by `express.json()`, so an attacker cannot
 *      forge a body without a CORS preflight the allowlist rejects.
 *
 * The suite asserts both: the cookie flags, and that form-encoded / text-plain
 * bodies cannot perform a state change even when the victim's cookie is
 * attached.
 */

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;
let receptionAgent: Agent;
let sessionCookie = '';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-csrf');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'receptionist'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }
  await User.create({
    email: 'reception@csrf.test',
    passwordHash: await hashPassword('Recept@12345'),
    role: 'receptionist',
    status: 'ACTIVE',
  });

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  receptionAgent = supertest.default.agent(app);
  const res = await receptionAgent.post('/api/v1/auth/login').send({
    email: 'reception@csrf.test',
    password: 'Recept@12345',
  });
  if (res.status !== 200) throw new Error(`reception login failed: ${res.status}`);
  const setCookie = res.headers['set-cookie'];
  sessionCookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('CSRF posture — session cookie flags', () => {
  it('session cookie is HttpOnly and SameSite=Lax (SEC-06)', () => {
    expect(sessionCookie).toContain('hms.sid=');
    expect(sessionCookie.toLowerCase()).toContain('httponly');
    expect(sessionCookie.toLowerCase()).toContain('samesite=lax');
  });
});

describe('CSRF posture — JSON-only writes block cross-site form forgery', () => {
  it('form-encoded POST with the victim cookie cannot create a patient', async () => {
    const { Patient } = await import('../../src/models/patient.model.js');
    const before = await Patient.countDocuments();

    const res = await (receptionAgent as unknown as Agent)
      .post('/api/v1/patients')
      .type('form')
      .send('firstName=Csrf&lastName=Attack&dob=1990-01-01&gender=other');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await Patient.countDocuments()).toBe(before);
    expect(await Patient.findOne({ firstName: 'Csrf' })).toBeNull();
  });

  it('text/plain POST with the victim cookie cannot create a patient either', async () => {
    const { Patient } = await import('../../src/models/patient.model.js');
    const before = await Patient.countDocuments();

    const res = await (receptionAgent as unknown as Agent)
      .post('/api/v1/patients')
      .set('Content-Type', 'text/plain')
      .send('firstName=Csrf&lastName=Attack&dob=1990-01-01&gender=other');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await Patient.countDocuments()).toBe(before);
  });

  it('positive control: the same write succeeds as application/json', async () => {
    const res = await (receptionAgent as unknown as Agent).post('/api/v1/patients').send({
      firstName: 'Legit',
      lastName: 'JsonWrite',
      dob: '1990-01-01',
      gender: 'other',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.firstName).toBe('Legit');
  });

  it('a mutating request without a session is rejected before the handler (401)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).post('/api/v1/patients').send({
      firstName: 'NoSession',
      lastName: 'Attack',
      dob: '1990-01-01',
      gender: 'other',
    });
    expect(res.status).toBe(401);

    const { Patient } = await import('../../src/models/patient.model.js');
    expect(await Patient.findOne({ firstName: 'NoSession' })).toBeNull();
  });
});
