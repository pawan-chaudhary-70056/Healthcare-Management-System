import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * tests/security — session cookie flags (SEC-06, NFR-11) + request-id posture.
 * Verifiable at the current phase; the remaining cases (IDOR sweep, injection,
 * XSS) land per the coverage map in tests/security/README.md as phases complete.
 */

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-security');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  await RoleModel.create({ name: 'admin', permissions: permissionsForRole('admin') });
  await User.create({
    email: 'admin@sec.test',
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

describe('security posture (Testing Strategy §3)', () => {
  it('sets HTTP-only SameSite session cookie on login (SEC-06)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).post('/api/v1/auth/login').send({
      email: 'admin@sec.test',
      password: 'Admin@12345',
    });
    expect(res.status).toBe(200);
    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeDefined();
    const cookie = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
    expect(cookie).toContain('hms.sid=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it('echoes/attaches X-Request-Id used as error traceId', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app)
      .get('/api/v1/does-not-exist')
      .set('X-Request-Id', 'trace-123');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe('trace-123');
    expect(res.body.error.traceId).toBe('trace-123');
  });

  it('sets core helmet headers', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
