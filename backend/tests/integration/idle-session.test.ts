import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  process.env.SESSION_IDLE_MINUTES = '30';
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  replSetRef = replSet;
  const mongoUri = replSet.getUri('hms-idle-test');
  process.env.MONGO_URI = mongoUri;

  const { connectDatabase } = await import('../../src/config/database.js');
  await connectDatabase(mongoUri);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  await RoleModel.create({ name: 'patient', permissions: permissionsForRole('patient') });
  await User.create({
    email: 'idle@test.local',
    passwordHash: await hashPassword('Idle@12345'),
    role: 'patient',
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

describe('idle session timeout (SEC-06, NFR-11, AC-08)', () => {
  it('keeps an active session working and stamps activity', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'idle@test.local', password: 'Idle@12345' });

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('patient');
  });

  it('expires a session idle beyond the configured window (simulated)', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'idle@test.local', password: 'Idle@12345' });

    // Simulate the passage of time beyond SESSION_IDLE_MINUTES.
    // connect-mongo serializes the session as a JSON string — rewrite it.
    const mongoose = (await import('mongoose')).default;
    const sessions = mongoose.connection.collection('sessions');
    const docs = await sessions.find({}).toArray();
    for (const doc of docs) {
      const raw = typeof doc.session === 'string' ? doc.session : JSON.stringify(doc.session);
      const parsed = JSON.parse(raw) as { lastActivityAt?: number };
      parsed.lastActivityAt = Date.now() - 31 * 60_000;
      await sessions.updateOne({ _id: doc._id }, { $set: { session: JSON.stringify(parsed) } });
    }

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_EXPIRED');
  });
});
