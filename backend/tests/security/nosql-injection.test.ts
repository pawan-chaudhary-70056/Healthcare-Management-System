import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * tests/security — NoSQL injection (Testing Strategy §3, SEC-17/SEC-19).
 *
 * Two attack surfaces are swept:
 *   1. JSON bodies — operator objects ({ $gt: '' }, { $ne: null }, $where) sent
 *      where a scalar is expected must be rejected by schema validation (422),
 *      never passed to Mongoose as a query object (auth-bypass class).
 *   2. Query strings — bracket notation (`?q[$ne]=`) must not deserialize into
 *      query operators. A 5xx here is a defect (unhandled operator object), and
 *      silently broadening the result set would be an authorization leak.
 *
 * The suite asserts the standard error envelope and that no 5xx escapes.
 */

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;
let adminAgent: Agent;
let nurseAgent: Agent;
let createdPatientId = '';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-nosql');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');
  const { Patient } = await import('../../src/models/patient.model.js');

  for (const role of ['admin', 'receptionist', 'patient', 'nurse'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }
  await User.create([
    {
      email: 'admin@nosql.test',
      passwordHash: await hashPassword('Admin@12345'),
      role: 'admin',
      status: 'ACTIVE',
    },
    {
      email: 'nurse@nosql.test',
      passwordHash: await hashPassword('Nurse@12345'),
      role: 'nurse',
      status: 'ACTIVE',
    },
  ]);
  const patient = await Patient.create({
    mrn: 'MRN-4000-0001',
    firstName: 'Victim',
    lastName: 'Record',
    dob: '1985-03-03',
    gender: 'other',
    contacts: { phone: '+15551212' },
  });
  createdPatientId = patient._id.toString();

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  adminAgent = supertest.default.agent(app);
  const res = await adminAgent.post('/api/v1/auth/login').send({
    email: 'admin@nosql.test',
    password: 'Admin@12345',
  });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);

  nurseAgent = supertest.default.agent(app);
  const nurseRes = await nurseAgent.post('/api/v1/auth/login').send({
    email: 'nurse@nosql.test',
    password: 'Nurse@12345',
  });
  if (nurseRes.status !== 200) throw new Error(`nurse login failed: ${nurseRes.status}`);
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('NoSQL injection — request bodies (auth-bypass class)', () => {
  it('login with operator-object credentials is rejected by validation (422)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // No session was minted.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login with $ne null credentials is rejected (422)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('login with a $where payload is rejected (422)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/login')
      .send({ email: { $where: 'return true' }, password: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('registration with operator-object email is rejected (422)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/register')
      .send({ email: { $gt: '' }, password: 'Password@123' });
    expect(res.status).toBe(422);
    // No account created via the operator.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('forgot-password with operator-object email is rejected (422)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: { $gt: '' } });
    expect(res.status).toBe(422);
  });
});

describe('NoSQL injection — query strings (operator deserialization)', () => {
  const probes: Array<{ name: string; url: string; agent: () => Agent }> = [
    { name: 'patient search q', url: '/api/v1/patients?q[$ne]=', agent: () => adminAgent },
    { name: 'lab orders patientId', url: '/api/v1/lab/orders?patientId[$ne]=', agent: () => adminAgent },
    { name: 'invoices patientId', url: '/api/v1/billing/invoices?patientId[$ne]=', agent: () => adminAgent },
    { name: 'appointments doctorId', url: '/api/v1/appointments?doctorId[$ne]=', agent: () => adminAgent },
    { name: 'nursing entries patientId', url: '/api/v1/clinical/nursing-entries?patientId[$ne]=', agent: () => nurseAgent },
  ];

  for (const probe of probes) {
    it(`${probe.name}: bracket-notation operator does not 5xx`, async () => {
      const res = await probe.agent().get(probe.url);
      expect(res.status, `${probe.name} returned ${res.status}`).toBeLessThan(500);
    });
  }

  it('malformed ObjectId in a list filter is a handled client error, not a 500', async () => {
    const res = await adminAgent.get('/api/v1/lab/orders?patientId=not-an-objectid');
    expect(res.status).toBeLessThan(500);
  });

  it('regex metacharacters in patient search are escaped (no wildcard match)', async () => {
    // ".*" must be treated literally: it cannot match the seeded record.
    const res = await adminAgent.get('/api/v1/patients?q=.*');
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ id: string }>;
    expect(rows.some((p) => p.id === createdPatientId)).toBe(false);
  });
});
