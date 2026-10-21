import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let mongoUri: string;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: { post: unknown; get: unknown; patch: unknown; put: unknown };
let receptionAgent: { post: unknown; get: unknown; patch: unknown; put: unknown };
let patientAgent: { post: unknown; get: unknown; patch: unknown; put: unknown };
let createdPatientId = '';

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  mongoUri = replSet.getUri('hms-test-patients');
  process.env.MONGO_URI = mongoUri;

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(mongoUri);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'receptionist', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }
  await User.create([
    { email: 'admin@p.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@p.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
    { email: 'patient@p.test', passwordHash: await hashPassword('Patient@12345'), role: 'patient', status: 'ACTIVE' },
  ]);

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  const login = async (email: string, password: string): Promise<Agent> => {
    const agent = supertest.default.agent(app);
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return agent;
  };
  adminAgent = await login('admin@p.test', 'Admin@12345');
  receptionAgent = await login('reception@p.test', 'Recept@12345');
  patientAgent = await login('patient@p.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('patients module (EP-10..14, AC-10..13)', () => {
  it('AC-10: receptionist creates a patient record (audited)', async () => {
    const res = await (receptionAgent as unknown as Agent)
      .post('/api/v1/patients')
      .send({
        firstName: 'Alice',
        lastName: 'Walkin',
        dob: '1990-05-01',
        gender: 'female',
        phone: '+15550001',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.mrn).toMatch(/^MRN-\d{4}-\d{4}$/);
    createdPatientId = res.body.data.id;

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'patient.create', resourceId: createdPatientId });
    expect(entry).toBeTruthy();
  });

  it('AC-12: patient requesting another record → FORBIDDEN + audited', async () => {
    const res = await (patientAgent as unknown as Agent).get(`/api/v1/patients/${createdPatientId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const denial = await AuditLog.findOne({
      action: 'security.access_denied',
      resourceId: createdPatientId,
      outcome: 'DENIED',
    });
    expect(denial).toBeTruthy();
  });

  it('AC-11: patient edits own record — non-identity only', async () => {
    // The registered patient has a linked patient record (created at register
    // time in PH-03); this user logged in without register flow, so link one.
    const { Patient } = await import('../../src/models/patient.model.js');
    const { User } = await import('../../src/models/user.model.js');
    const me = await (patientAgent as unknown as Agent).get('/api/v1/auth/me');
    const user = await User.findById(me.body.data.user.id);
    const existing = await Patient.findOne({ userId: user!._id });
    const ownId =
      existing?._id?.toString() ??
      (await Patient.create({
        userId: user!._id,
        mrn: 'MRN-2000-9999',
        firstName: 'Pat',
        lastName: 'Ient',
        dob: '1980-01-01',
        gender: 'other',
      }))._id.toString();

    const okRes = await (patientAgent as unknown as Agent)
      .patch(`/api/v1/patients/${ownId}`)
      .send({ phone: '+15559999' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.contacts.phone).toBe('+15559999');

    // Identity-critical change rejected.
    const bad = await (patientAgent as unknown as Agent)
      .patch(`/api/v1/patients/${ownId}`)
      .send({ dob: '1975-01-01' });
    expect(bad.status).toBe(403);
  });

  it('EP-14: consents updated with flags + audit', async () => {
    const res = await (receptionAgent as unknown as Agent)
      .put(`/api/v1/patients/${createdPatientId}/consents`)
      .send({ consents: [{ type: 'share_with_lab', granted: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.consentFlags.share_with_lab).toBe(true);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'patient.consent_update', resourceId: createdPatientId });
    expect(entry).toBeTruthy();
  });

  it('admin reads any patient record (patient.read.all projection)', async () => {
    const res = await (adminAgent as unknown as Agent).get(`/api/v1/patients/${createdPatientId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdPatientId);
  });

  it('patient create requires patient.create permission (403 for patient role)', async () => {
    const res = await (patientAgent as unknown as Agent)
      .post('/api/v1/patients')
      .send({ firstName: 'X', lastName: 'Y', dob: '1990-01-01', gender: 'other' });
    expect(res.status).toBe(403);
  });
});
