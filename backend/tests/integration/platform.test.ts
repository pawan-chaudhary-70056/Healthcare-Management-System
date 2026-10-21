import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let nurseAgent: Awaited<ReturnType<typeof mkAgent>>;
let patientAgent: Awaited<ReturnType<typeof mkAgent>>;

let adminId = '';
let doctorId = '';
let patientId = '';

async function mkAgent(
  app: Express,
  email: string,
  password: string
): Promise<import('supertest').SuperAgentTest> {
  const supertest = await import('supertest');
  const agent = supertest.default.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-platform');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'doctor', 'nurse', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const admin = await User.create({
    email: 'admin@pf.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE',
  });
  adminId = String(admin._id);
  const doctor = await User.create({
    email: 'doctor@pf.test', passwordHash: await hashPassword('Doctor@12345'), role: 'doctor', status: 'ACTIVE',
  });
  doctorId = String(doctor._id);
  await User.create({
    email: 'nurse@pf.test', passwordHash: await hashPassword('Nurse@12345'), role: 'nurse', status: 'ACTIVE',
  });
  const patientUser = await User.create({
    email: 'patient@pf.test', passwordHash: await hashPassword('Patient@12345'), role: 'patient', status: 'ACTIVE',
  });

  const dept = await Department.create({ name: 'Emergency', publicVisible: true });
  const patient = await Patient.create({
    userId: patientUser._id,
    mrn: 'MRN-7001-0001',
    firstName: 'Emerg',
    lastName: 'Patient',
    dob: '1960-03-03',
    gender: 'male',
  });
  patientId = String(patient._id);
  void dept;

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  adminAgent = await mkAgent(app, 'admin@pf.test', 'Admin@12345');
  doctorAgent = await mkAgent(app, 'doctor@pf.test', 'Doctor@12345');
  nurseAgent = await mkAgent(app, 'nurse@pf.test', 'Nurse@12345');
  patientAgent = await mkAgent(app, 'patient@pf.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('platform (PH-08, AC-50..61)', () => {
  it('Notifications: users list their own; outbox drains in_app', async () => {
    const { enqueue } = await import('../../src/services/notification.service.js');
    await enqueue({ userId: doctorId, event: 'lab.result_released', payload: { orderId: 'x' } });

    const mine = await doctorAgent.get('/api/v1/platform/notifications');
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThanOrEqual(1);

    const { drainQueue } = await import('../../src/services/notification.service.js');
    const result = { sent: await drainQueue() };
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const { Notification } = await import('../../src/models/notification.model.js');
    const sent = await Notification.findOne({ userId: doctorId, event: 'lab.result_released' });
    expect(sent!.status).toBe('SENT');
  });

  it('EP-72: policy settings — admin updates are hot-applied + audited; others blocked', async () => {
    const forbidden = await doctorAgent.put('/api/v1/platform/settings/policy/BOOKING_HORIZON_DAYS').send({ value: 7 });
    expect(forbidden.status).toBe(403);

    const res = await adminAgent.put('/api/v1/platform/settings/policy/BOOKING_HORIZON_DAYS').send({ value: 7 });
    expect(res.status).toBe(200);

    // Hot-applied to the running policy (A-07 seam).
    const { getPolicy } = await import('../../src/config/policy.loader.js');
    expect(getPolicy().BOOKING_HORIZON_DAYS).toBe(7);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'admin.policy_update', resourceId: 'BOOKING_HORIZON_DAYS' });
    expect(entry).toBeTruthy();

    const bad = await adminAgent.put('/api/v1/platform/settings/policy/NOT_A_KEY').send({ value: 1 });
    expect(bad.status).toBe(422);
  });

  it('EP-73: audit viewer — admin sees all; doctor only own events', async () => {
    const adminView = await adminAgent.get('/api/v1/platform/audit?limit=5');
    expect(adminView.status).toBe(200);

    const doctorView = await doctorAgent.get('/api/v1/platform/audit?limit=50');
    expect(doctorView.status).toBe(200);
    for (const item of doctorView.body.data) {
      expect(String(item.actorId?._id ?? item.actorId)).toBe(doctorId);
    }

    const patientTry = await patientAgent.get('/api/v1/platform/audit');
    expect(patientTry.status).toBe(403);
  });

  it('AC-60: break-glass — mandatory reason, time-limited window, immediate admin alert', async () => {
    const short = await doctorAgent.post('/api/v1/platform/break-glass').send({ patientId, reason: 'short' });
    expect(short.status).toBe(422);

    const req = await doctorAgent.post('/api/v1/platform/break-glass').send({
      patientId,
      reason: 'Unconscious ER patient, records locked out of hours',
    });
    expect(req.status).toBe(200);
    expect(req.body.data.status).toBe('ACTIVE');
    const bgId = req.body.data.id;
    const expiresAt = new Date(req.body.data.expiresAt);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Immediate oversight alert to admin (in-app notification).
    const { Notification } = await import('../../src/models/notification.model.js');
    const alert = await Notification.findOne({ userId: adminId, event: 'breakglass.requested' });
    expect(alert).toBeTruthy();

    // Audited.
    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'breakglass.request', resourceId: bgId });
    expect(entry).toBeTruthy();

    // Patient cannot use break-glass.
    const patientTry = await patientAgent.post('/api/v1/platform/break-glass').send({ patientId, reason: 'not allowed at all' });
    expect(patientTry.status).toBe(403);

    // Revoke by requester.
    const revoke = await doctorAgent.post(`/api/v1/platform/break-glass/${bgId}/revoke`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.status).toBe('REVOKED');
  });

  it('AC-61: break-glass review flow with 72h window; expiry sweep works', async () => {
    const req = await nurseAgent.post('/api/v1/platform/break-glass').send({
      patientId,
      reason: 'Critical medication reconciliation needed urgently',
    });
    const bgId = req.body.data.id;

    // Review while ACTIVE → rejected.
    const early = await adminAgent.post(`/api/v1/platform/break-glass/${bgId}/review`).send({ notes: 'too early' });
    expect(early.status).toBe(422);

    // Simulate window passing → sweep expires it.
    const { expireStaleBreakGlass } = await import('../../src/services/platform.service.js');
    const expired = await expireStaleBreakGlass(new Date(Date.now() + 2 * 60 * 60_000));
    expect(expired).toBeGreaterThanOrEqual(1);

    // Admin reviews.
    const review = await adminAgent.post(`/api/v1/platform/break-glass/${bgId}/review`).send({ notes: 'Legitimate ER access — reviewed' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('REVIEWED');

    // Nurse cannot review.
    const req2 = await nurseAgent.post('/api/v1/platform/break-glass').send({
      patientId,
      reason: 'Second scenario for permission check test',
    });
    const reviewDenied = await nurseAgent.post(`/api/v1/platform/break-glass/${req2.body.data.id}/review`).send({ notes: 'self review' });
    expect(reviewDenied.status).toBe(403);
  });

  it('hasActiveBreakGlass gates scope escalation correctly', async () => {
    const { hasActiveBreakGlass } = await import('../../src/services/platform.service.js');
    const req = await doctorAgent.post('/api/v1/platform/break-glass').send({
      patientId,
      reason: 'Scope gate verification for active windows',
    });
    const bgId = req.body.data.id;
    expect(await hasActiveBreakGlass(patientId, doctorId)).toBe(true);

    await doctorAgent.post(`/api/v1/platform/break-glass/${bgId}/revoke`);
    expect(await hasActiveBreakGlass(patientId, doctorId)).toBe(false);
  });
});
