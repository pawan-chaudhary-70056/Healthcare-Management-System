import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * tests/security — IDOR sweep (Testing Strategy §3, Build TODOs PH-09).
 *
 * Object-level authorization is exercised end-to-end: a foreign actor presents
 * a valid session + the route permission, but the record belongs to someone
 * else. The contract is "403 + `security.access_denied` audit entry" for record
 * reads that gate on scope, and "no foreign data returned" for list endpoints
 * that scope by construction (a leak here would be an IDOR too).
 *
 * Records are created directly against the models so every module's scope
 * check can be swept without replaying the full clinical journey.
 */

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let patientA: Agent; // owner of every fixture record
let patientB: Agent; // foreign actor — must be denied
let doctorA: Agent; // owner clinician
let doctorB: Agent; // foreign clinician — must be denied

let patientAId = '';
let encounterAId = '';
let labOrderAId = '';
let invoiceAId = '';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-idor');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const mongoose = (await import('mongoose')).default;
  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { Encounter, NursingEntry } = await import('../../src/models/clinical.model.js');
  const { LabOrder } = await import('../../src/models/lab.model.js');
  const { Invoice } = await import('../../src/models/billing.model.js');

  for (const role of ['patient', 'doctor', 'nurse'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const [userA, userB, docA] = await User.create([
    { email: 'alice@idor.test', passwordHash: await hashPassword('Patient@12345'), role: 'patient', status: 'ACTIVE' },
    { email: 'bob@idor.test', passwordHash: await hashPassword('Patient@12345'), role: 'patient', status: 'ACTIVE' },
    { email: 'dr.a@idor.test', passwordHash: await hashPassword('Doctor@12345'), role: 'doctor', status: 'ACTIVE' },
    { email: 'dr.b@idor.test', passwordHash: await hashPassword('Doctor@12345'), role: 'doctor', status: 'ACTIVE' },
  ]);

  const [recA] = await Patient.create([
    { userId: userA._id, mrn: 'MRN-3000-0001', firstName: 'Alice', lastName: 'Owner', dob: '1990-01-01', gender: 'female' },
    { userId: userB._id, mrn: 'MRN-3000-0002', firstName: 'Bob', lastName: 'Foreign', dob: '1991-02-02', gender: 'male' },
  ]);
  patientAId = recA._id.toString();

  const encounter = await Encounter.create({
    patientId: recA._id,
    doctorId: docA._id,
    departmentId: new mongoose.Types.ObjectId(),
    appointmentId: new mongoose.Types.ObjectId(),
    status: 'OPEN',
    createdBy: String(docA._id),
  });
  encounterAId = encounter._id.toString();

  const labOrder = await LabOrder.create({
    patientId: recA._id,
    encounterId: encounter._id,
    doctorId: docA._id,
    testCode: 'CBC',
    testName: 'Complete Blood Count',
    priority: 'routine',
    status: 'ORDERED',
  });
  labOrderAId = labOrder._id.toString();

  await NursingEntry.create({
    patientId: recA._id,
    nurseId: String(docA._id),
    category: 'vitals',
    note: 'BP 120/80',
  });

  const invoice = await Invoice.create({
    patientId: recA._id,
    invoiceNo: 'INV-IDOR-0001',
    status: 'ISSUED',
    lines: [],
    subtotalMinor: 5000,
    discountMinor: 0,
    paidMinor: 0,
    refundedMinor: 0,
    createdBy: String(docA._id),
  });
  invoiceAId = invoice._id.toString();

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  const login = async (email: string, password: string): Promise<Agent> => {
    const agent = supertest.default.agent(app);
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return agent;
  };
  patientA = await login('alice@idor.test', 'Patient@12345');
  patientB = await login('bob@idor.test', 'Patient@12345');
  doctorA = await login('dr.a@idor.test', 'Doctor@12345');
  doctorB = await login('dr.b@idor.test', 'Doctor@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

/** Assert a denial wrote an audited `security.access_denied` entry (R-08). */
async function expectAuditDenied(resourceId: string, module?: string) {
  const { AuditLog } = await import('../../src/models/audit-log.model.js');
  const query: Record<string, unknown> = {
    action: 'security.access_denied',
    resourceId,
    outcome: 'DENIED',
  };
  if (module) query.module = module; // disambiguate when several modules guard the same id
  const entry = await AuditLog.findOne(query);
  expect(entry, `expected an audited denial for ${resourceId}${module ? ` in ${module}` : ''}`).toBeTruthy();
}

describe('IDOR sweep — cross-patient record access (Testing Strategy §3)', () => {
  it('foreign patient reading another patient record → 403 + audit (patients)', async () => {
    const res = await (patientB as unknown as Agent).get(`/api/v1/patients/${patientAId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(patientAId, 'patients');
  });

  it('foreign patient reading another patient summary → 403', async () => {
    const res = await (patientB as unknown as Agent).get(`/api/v1/patients/${patientAId}/summary`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(patientAId, 'patients');
  });

  it('foreign patient updating another patient record → 403 (no write)', async () => {
    const res = await (patientB as unknown as Agent)
      .patch(`/api/v1/patients/${patientAId}`)
      .send({ phone: '+15550000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(patientAId, 'patients');

    // The target record is untouched.
    const { Patient } = await import('../../src/models/patient.model.js');
    const owner = await Patient.findById(patientAId).lean();
    expect(owner!.contacts?.phone).not.toBe('+15550000');
  });

  it('foreign patient reading another patient nursing entries → 403 + audit (clinical)', async () => {
    const res = await (patientB as unknown as Agent).get(
      `/api/v1/clinical/nursing-entries?patientId=${patientAId}`
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(patientAId, 'clinical');
  });

  it('foreign patient reading another patient lab order → 403 + audit (lab)', async () => {
    const res = await (patientB as unknown as Agent).get(`/api/v1/lab/orders/${labOrderAId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(labOrderAId, 'lab');
  });
});

describe('IDOR sweep — cross-clinician record access', () => {
  it('foreign doctor reading another doctor encounter → 403 + audit (clinical)', async () => {
    const res = await (doctorB as unknown as Agent).get(`/api/v1/clinical/encounters/${encounterAId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(encounterAId, 'clinical');
  });

  it('foreign doctor reading another doctor lab order → 403 + audit (lab)', async () => {
    const res = await (doctorB as unknown as Agent).get(`/api/v1/lab/orders/${labOrderAId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectAuditDenied(labOrderAId, 'lab');
  });
});

describe('IDOR sweep — scoped lists never leak foreign rows', () => {
  it('patient lab-order list is pinned to the caller even when a foreign patientId is supplied', async () => {
    const res = await (patientB as unknown as Agent).get(
      `/api/v1/lab/orders?patientId=${patientAId}`
    );
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ patientId: string }>;
    expect(rows.some((o) => o.patientId === patientAId)).toBe(false);
  });

  it('patient invoice list is pinned to the caller even when a foreign patientId is supplied', async () => {
    const res = await (patientB as unknown as Agent).get(
      `/api/v1/billing/invoices?patientId=${patientAId}`
    );
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ patientId: string }>;
    expect(rows.some((i) => i.patientId === patientAId)).toBe(false);

    // Direct object fetch of the foreign invoice is a 404, not a leak.
    const direct = await (patientB as unknown as Agent).get(`/api/v1/billing/invoices/${invoiceAId}`);
    expect(direct.status).toBe(404);
    expect(direct.body.data).toBeNull();
  });

  it('patient prescription list is pinned to the caller even when a foreign patientId is supplied', async () => {
    const res = await (patientB as unknown as Agent).get(
      `/api/v1/clinical/prescriptions?patientId=${patientAId}`
    );
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ patientId: string }>;
    expect(rows.some((p) => p.patientId === patientAId)).toBe(false);
  });
});

describe('IDOR sweep — positive controls (own records still accessible)', () => {
  it('owner patient reads own record', async () => {
    const res = await (patientA as unknown as Agent).get(`/api/v1/patients/${patientAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(patientAId);
  });

  it('owner doctor reads own encounter', async () => {
    const res = await (doctorA as unknown as Agent).get(`/api/v1/clinical/encounters/${encounterAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(encounterAId);
  });

  it('owner doctor reads own lab order', async () => {
    const res = await (doctorA as unknown as Agent).get(`/api/v1/lab/orders/${labOrderAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(labOrderAId);
  });
});
