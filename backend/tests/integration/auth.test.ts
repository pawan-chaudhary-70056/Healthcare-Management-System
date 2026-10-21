import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let mongoUri: string;
let replSetRef: { stop: () => Promise<void> } | null = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = ''; // MFA flows covered in mfa.test.ts
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  mongoUri = replSet.getUri('hms-test');
  process.env.MONGO_URI = mongoUri;

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(mongoUri);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  await RoleModel.create({ name: 'admin', permissions: permissionsForRole('admin') });
  await User.create({
    email: 'admin@test.local',
    passwordHash: await hashPassword('Admin@12345'),
    role: 'admin',
    status: 'ACTIVE',
  });

  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('auth flow', () => {
  it('rejects bad credentials generically (SEC-02)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).post('/api/v1/auth/login').send({
      email: 'admin@test.local',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unknown account with the same generic error (anti-enumeration)', async () => {
    const supertest = await import('supertest');
    const res = await supertest
      .default(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in with valid credentials and returns permissions', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({
      email: 'admin@test.local',
      password: 'Admin@12345',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('admin');
    expect(login.body.data.permissions).toContain('user.manage');

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('admin');
    expect(me.body.data.user.permissions).toContain('user.manage');
  });

  it('rejects protected route without session (401 SESSION_EXPIRED)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('denies admin-only route to missing permission (403 FORBIDDEN)', async () => {
    const supertest = await import('supertest');
    // unauthenticated → 401
    const noAuth = await supertest.default(app).get('/api/v1/admin/departments');
    expect(noAuth.status).toBe(401);

    // authenticated admin (has settings.manage) → 200
    const agent = supertest.default.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'Admin@12345' });
    const authed = await agent.get('/api/v1/admin/departments');
    expect(authed.status).toBe(200);
  });
});
