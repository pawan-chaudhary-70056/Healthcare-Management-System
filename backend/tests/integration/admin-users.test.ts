import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * Admin user & role management (EP-70/71, PERM-60/61) + backups (EP-74, PERM-68).
 *
 * Covers the acceptance criteria that were previously unrouted:
 *   AC-56 — role change requires re-auth, is validated, audited, and takes
 *           effect on the next authorization check (target sessions dropped).
 *   AC-58 — an Admin-triggered backup completes with a verifiable result and is
 *           logged.
 * Plus minimum-necessary projections (no password/MFA secrets) and negative
 * authorization (non-admin → 403).
 */

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;
let adminAgent: Agent;
let doctorAgent: Agent;
let createdUserId = '';

const ADMIN_PASSWORD = 'Admin@12345';
const STAFF_PASSWORD = 'Doctor@12345';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-admin-users');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'doctor', 'receptionist'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }
  await User.create({
    email: 'admin@users.test',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: 'admin',
    status: 'ACTIVE',
  });

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  const login = async (email: string, password: string): Promise<Agent> => {
    const agent = supertest.default.agent(app);
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return agent;
  };
  adminAgent = await login('admin@users.test', ADMIN_PASSWORD);

  // A staff account created through EP-70, used for the role-change tests.
  const created = await (adminAgent as unknown as Agent).post('/api/v1/admin/users').send({
    email: 'staff@users.test',
    password: STAFF_PASSWORD,
    role: 'doctor',
    fullName: 'Staff Member',
  });
  if (created.status !== 201) throw new Error(`staff create failed: ${created.status}`);
  createdUserId = created.body.data.id;
  doctorAgent = await login('staff@users.test', STAFF_PASSWORD);
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('admin user management (EP-70, PERM-60)', () => {
  it('non-admin cannot list or create users → 403', async () => {
    const list = await (doctorAgent as unknown as Agent).get('/api/v1/admin/users');
    expect(list.status).toBe(403);
    const create = await (doctorAgent as unknown as Agent).post('/api/v1/admin/users').send({
      email: 'x@users.test',
      password: 'Password@123',
      role: 'nurse',
    });
    expect(create.status).toBe(403);
  });

  it('creates a staff account, audited, without leaking secrets', async () => {
    const res = await (adminAgent as unknown as Agent).post('/api/v1/admin/users').send({
      email: 'nurse1@users.test',
      password: 'Nurse@12345',
      role: 'nurse',
      fullName: 'Nurse One',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.role).toBe('nurse');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('secretEncrypted');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'user.create', resourceId: res.body.data.id });
    expect(entry).toBeTruthy();
  });

  it('rejects patient-role provisioning (patients self-register, EP-04)', async () => {
    const res = await (adminAgent as unknown as Agent).post('/api/v1/admin/users').send({
      email: 'p@users.test',
      password: 'Patient@1234',
      role: 'patient',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists users with a minimum-necessary projection', async () => {
    const res = await (adminAgent as unknown as Agent).get('/api/v1/admin/users?limit=50');
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((u) => u.email && u.role && u.status)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('passwordHash');
    expect(JSON.stringify(rows)).not.toContain('secretEncrypted');
  });

  it('suspends a user and audits it (user.suspend)', async () => {
    const res = await (adminAgent as unknown as Agent)
      .patch(`/api/v1/admin/users/${createdUserId}`)
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'user.suspend', resourceId: createdUserId });
    expect(entry).toBeTruthy();

    // Suspension drops the target's sessions — their old cookie no longer works.
    const me = await (doctorAgent as unknown as Agent).get('/api/v1/auth/me');
    expect(me.status).toBe(401);

    // Reactivate for the role-change test.
    await (adminAgent as unknown as Agent)
      .patch(`/api/v1/admin/users/${createdUserId}`)
      .send({ status: 'ACTIVE' });
  });
});

describe('role assignment (EP-71, PERM-61, AC-56)', () => {
  it('rejects a role change without correct re-authentication', async () => {
    const res = await (adminAgent as unknown as Agent)
      .put(`/api/v1/admin/users/${createdUserId}/role`)
      .send({ role: 'receptionist', currentPassword: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const denial = await AuditLog.findOne({
      action: 'security.access_denied',
      resourceId: createdUserId,
      outcome: 'DENIED',
    });
    expect(denial).toBeTruthy();
  });

  it('changes the role with re-auth, audits from→to, and invalidates target sessions', async () => {
    // The target is logged in again after the suspension test.
    const freshTarget = (await import('supertest')).default.agent(app);
    const login = await freshTarget.post('/api/v1/auth/login').send({
      email: 'staff@users.test',
      password: STAFF_PASSWORD,
    });
    expect(login.status).toBe(200);

    const res = await (adminAgent as unknown as Agent)
      .put(`/api/v1/admin/users/${createdUserId}/role`)
      .send({ role: 'receptionist', currentPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('receptionist');
    expect(res.body.data.previousRole).toBe('doctor');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'user.role_assign', resourceId: createdUserId });
    expect(entry).toBeTruthy();
    expect((entry!.details as { from: string; to: string }).from).toBe('doctor');
    expect((entry!.details as { to: string }).to).toBe('receptionist');

    // AC-56: the role takes effect only after re-authorization — the target's
    // pre-change session is gone.
    const me = await freshTarget.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });

  it('refuses to change the acting admin’s own role', async () => {
    const me = await (adminAgent as unknown as Agent).get('/api/v1/auth/me');
    const adminId = me.body.data.user.id;
    const res = await (adminAgent as unknown as Agent)
      .put(`/api/v1/admin/users/${adminId}/role`)
      .send({ role: 'doctor', currentPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(422);
  });
});

describe('backup trigger (EP-74, PERM-68, AC-58)', () => {
  it('non-admin cannot trigger a backup → 403', async () => {
    // Fresh login: earlier role/suspension tests deliberately dropped sessions.
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({
      email: 'staff@users.test',
      password: STAFF_PASSWORD,
    });
    expect(login.status).toBe(200);
    const res = await agent.post('/api/v1/admin/backups');
    expect(res.status).toBe(403);
  });

  it('admin triggers a backup that returns a verifiable, logged result', async () => {
    const res = await (adminAgent as unknown as Agent).post('/api/v1/admin/backups');
    expect(res.status).toBe(201);
    expect(res.body.data.backupId).toBeTruthy();
    expect(res.body.data.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(res.body.data.collections)).toBe(true);
    expect(res.body.data.collections.length).toBeGreaterThan(0);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({
      action: 'admin.backup_trigger',
      resourceId: res.body.data.backupId,
    });
    expect(entry).toBeTruthy();
  });
});
