import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * tests/security — XSS (Testing Strategy §3, SEC: stored/reflected payloads).
 *
 * The API is JSON-only (there is no server-side HTML rendering), so the backend
 * contract is "stored safe": a script payload must round-trip as inert data and
 * every response that could carry it must be declared `application/json` with
 * `X-Content-Type-Options: nosniff`, so a browser can never interpret it as
 * HTML. `script-src 'self'` (helmet CSP) is the defense-in-depth layer for the
 * React client, which encodes values on render.
 */

type Agent = ReturnType<(typeof import('supertest'))['default']['agent']>;

const SCRIPT_PAYLOAD = '<script>alert("xss")</script>';
const IMG_PAYLOAD = '"><img src=x onerror=alert(1)>';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;
let receptionAgent: Agent;
let adminAgent: Agent;

/** The response is inert JSON: a browser will not treat it as HTML. */
function expectInertJson(res: { headers: Record<string, unknown>; text?: string }) {
  const contentType = String(res.headers['content-type'] ?? '');
  expect(contentType).toContain('application/json');
  expect(contentType).not.toContain('text/html');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.MFA_REQUIRED_ROLES = '';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  process.env.MONGO_URI = replSet.getUri('hms-test-xss');

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'receptionist'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }
  await User.create([
    {
      email: 'reception@xss.test',
      passwordHash: await hashPassword('Recept@12345'),
      role: 'receptionist',
      status: 'ACTIVE',
    },
    {
      email: 'admin@xss.test',
      passwordHash: await hashPassword('Admin@12345'),
      role: 'admin',
      status: 'ACTIVE',
    },
  ]);

  const { createApp } = await import('../../src/app.js');
  app = createApp();

  const supertest = await import('supertest');
  receptionAgent = supertest.default.agent(app);
  const res = await receptionAgent.post('/api/v1/auth/login').send({
    email: 'reception@xss.test',
    password: 'Recept@12345',
  });
  if (res.status !== 200) throw new Error(`reception login failed: ${res.status}`);

  adminAgent = supertest.default.agent(app);
  const adminRes = await adminAgent.post('/api/v1/auth/login').send({
    email: 'admin@xss.test',
    password: 'Admin@12345',
  });
  if (adminRes.status !== 200) throw new Error(`admin login failed: ${adminRes.status}`);
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('XSS — stored payloads are inert data', () => {
  let patientId = '';

  it('stores a <script> payload verbatim without stripping or executing it', async () => {
    const res = await (receptionAgent as unknown as Agent).post('/api/v1/patients').send({
      firstName: SCRIPT_PAYLOAD,
      lastName: 'Payload',
      dob: '1990-01-01',
      gender: 'other',
      address: IMG_PAYLOAD,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.firstName).toBe(SCRIPT_PAYLOAD);
    expect(res.body.data.contacts.address).toBe(IMG_PAYLOAD);
    patientId = res.body.data.id;
    expectInertJson(res);
  });

  it('returns the stored payload as JSON with nosniff (never text/html)', async () => {
    const res = await (adminAgent as unknown as Agent).get(`/api/v1/patients/${patientId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe(SCRIPT_PAYLOAD);
    expectInertJson(res);
  });

  it("serves helmet's restrictive CSP as defense in depth", async () => {
    const res = await (adminAgent as unknown as Agent).get(`/api/v1/patients/${patientId}`);
    const csp = String(res.headers['content-security-policy'] ?? '');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe('XSS — reflected input is never echoed into markup', () => {
  it('validation errors return JSON and do not reflect the submitted payload', async () => {
    const res = await (receptionAgent as unknown as Agent)
      .post('/api/v1/patients')
      .send({ firstName: SCRIPT_PAYLOAD, gender: 'other' }); // missing lastName + dob
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expectInertJson(res);
    // The envelope carries field names/messages only — no reflected value.
    expect(JSON.stringify(res.body)).not.toContain(SCRIPT_PAYLOAD);
  });

  it('unknown API routes fall back to a JSON 404, never an HTML error page', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get(`/api/v1/nope/${encodeURIComponent(SCRIPT_PAYLOAD)}`);
    expect(res.status).toBe(404);
    expectInertJson(res);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
