import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-value-for-vitest-only';
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

describe('GET /health', () => {
  it('returns ok status', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('hms-backend');
  });

  it('returns 404 with standard envelope for unknown route', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.traceId).toBeTruthy();
  });
});
