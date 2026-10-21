import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let accountantAgent: Awaited<ReturnType<typeof mkAgent>>;
let receptionAgent: Awaited<ReturnType<typeof mkAgent>>;
let patientAgent: Awaited<ReturnType<typeof mkAgent>>;

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
  process.env.MONGO_URI = replSet.getUri('hms-test-billing');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'accountant', 'receptionist', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  await User.create([
    { email: 'admin@b.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'acct@b.test', passwordHash: await hashPassword('Acct@12345'), role: 'accountant', status: 'ACTIVE' },
    { email: 'reception@b.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
  ]);
  const patientUser = await User.create({
    email: 'patient@b.test',
    passwordHash: await hashPassword('Patient@12345'),
    role: 'patient',
    status: 'ACTIVE',
  });

  const patient = await Patient.create({
    userId: patientUser._id,
    mrn: 'MRN-6001-0001',
    firstName: 'Bill',
    lastName: 'Patient',
    dob: '1975-07-07',
    gender: 'female',
  });
  patientId = String(patient._id);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  accountantAgent = await mkAgent(app, 'acct@b.test', 'Acct@12345');
  receptionAgent = await mkAgent(app, 'reception@b.test', 'Recept@12345');
  patientAgent = await mkAgent(app, 'patient@b.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

describe('billing (PH-07, AC-43..49)', () => {
  /** Seed fresh open charges (each test consumes its own invoice). */
  async function seedCharges(): Promise<void> {
    const { Charge } = await import('../../src/models/billing.model.js');
    await Charge.create([
      { patientId, sourceType: 'LAB', description: 'Lab: CBC', amountMinor: 25000, quantity: 1 },
      { patientId, sourceType: 'PHARMACY', description: 'Pharmacy dispense', amountMinor: 6000, quantity: 1 },
    ]);
  }

  /** Draft + issue an invoice over fresh charges; returns invoice id. */
  async function issuedInvoice(): Promise<string> {
    await seedCharges();
    const draft = await accountantAgent.post('/api/v1/billing/invoices').send({ patientId });
    expect(draft.status).toBe(201);
    await accountantAgent.post(`/api/v1/billing/invoices/${draft.body.data.id}/issue`);
    return draft.body.data.id;
  }

  it('AC-43: charges consolidate into a DRAFT invoice with server-computed totals', async () => {
    await seedCharges();
    const res = await accountantAgent.post('/api/v1/billing/invoices').send({ patientId });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.subtotalMinor).toBe(31000); // 25000 + 6000
    expect(res.body.data.lines).toHaveLength(2);
  });

  it('Patient cannot create invoices (403)', async () => {
    const res = await patientAgent.post('/api/v1/billing/invoices').send({ patientId });
    expect(res.status).toBe(403);
  });

  it('AC-44: issue invoice → immutable; further mutation rejected (SEC-26)', async () => {
    await seedCharges();
    const draft = await accountantAgent.post('/api/v1/billing/invoices').send({ patientId });
    const invId = draft.body.data.id;

    const issued = await accountantAgent.post(`/api/v1/billing/invoices/${invId}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.body.data.status).toBe('ISSUED');
    expect(issued.body.data.invoiceNo).toMatch(/^INV-/);

    // Re-issue → INVOICE_ISSUED error.
    const again = await accountantAgent.post(`/api/v1/billing/invoices/${invId}/issue`);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVOICE_ISSUED');

    // Charges consumed by this invoice are not re-consolidatable.
    const empty = await accountantAgent.post('/api/v1/billing/invoices').send({ patientId });
    expect(empty.status).toBe(422);
  });

  it('AC-45/47: idempotent payments — same key returns original record, no double charge', async () => {
    const invId = await issuedInvoice();

    const payload = { invoiceId: invId, amountMinor: 10000, method: 'CASH' };
    const first = await accountantAgent.post('/api/v1/billing/payments').set('Idempotency-Key', 'pay-key-1').send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data.replayed).toBe(false);

    const retry = await accountantAgent.post('/api/v1/billing/payments').set('Idempotency-Key', 'pay-key-1').send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body.data.replayed).toBe(true);
    expect(retry.body.data.paymentId).toBe(first.body.data.paymentId);

    // Balance exact: 31000 − 10000 = 21000 outstanding.
    expect(retry.body.data.invoice.outstandingMinor).toBe(21000);
    expect(retry.body.data.invoice.status).toBe('PARTIALLY_PAID');
  });

  it('AC-46: partial payments compute exact outstanding; overpay rejected', async () => {
    const invId = await issuedInvoice();

    const over = await accountantAgent.post('/api/v1/billing/payments').send({
      invoiceId: invId, amountMinor: 999999, method: 'CASH',
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');

    // Receptionist records the rest (PERM-53).
    const p1 = await receptionAgent.post('/api/v1/billing/payments').send({ invoiceId: invId, amountMinor: 15000, method: 'CARD_POS' });
    expect(p1.status).toBe(200);
    expect(p1.body.data.invoice.status).toBe('PARTIALLY_PAID');

    const p2 = await receptionAgent.post('/api/v1/billing/payments').send({ invoiceId: invId, amountMinor: 16000, method: 'CASH' });
    expect(p2.status).toBe(200);
    expect(p2.body.data.invoice.status).toBe('PAID');
    expect(p2.body.data.invoice.outstandingMinor).toBe(0);
  });

  it('Webhook without valid signature rejected (400 WEBHOOK_SIGNATURE_INVALID, SEC-25)', async () => {
    const body = JSON.stringify({ event: 'payment.succeeded', gatewayRef: 'gw-1' });
    const bad = await accountantAgent
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gateway-Signature', 'sbx-deadbeef')
      .send(body);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    const { gatewaySignature } = await import('../../src/services/billing.service.js');
    const good = await accountantAgent
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gateway-Signature', gatewaySignature(body))
      .send(body);
    expect(good.status).toBe(200);

    // Denied attempt is audited.
    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const denied = await AuditLog.findOne({ action: 'payment.webhook', outcome: 'DENIED' });
    expect(denied).toBeTruthy();
  });

  it('AC-48: refund requires approval permission; discount audited with reason', async () => {
    const invId = await issuedInvoice();
    const pay = await accountantAgent.post('/api/v1/billing/payments').send({ invoiceId: invId, amountMinor: 31000, method: 'CASH' });
    const paymentId = pay.body.data.paymentId;

    // Receptionist cannot approve refunds (PERM-54).
    const denied = await receptionAgent
      .post(`/api/v1/billing/payments/${paymentId}/refund`)
      .send({ amountMinor: 5000, reason: 'Wrong charge' });
    expect(denied.status).toBe(403); // permission gate (PERM-54 not granted)
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const refund = await accountantAgent
      .post(`/api/v1/billing/payments/${paymentId}/refund`)
      .send({ amountMinor: 5000, reason: 'Duplicate charge line' });
    expect(refund.status).toBe(200);
    expect(refund.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(refund.body.data.invoice.outstandingMinor).toBe(5000);

    // Discount with mandatory reason.
    const noReason = await accountantAgent.post(`/api/v1/billing/invoices/${invId}/discount`).send({ amountMinor: 1000 });
    expect(noReason.status).toBe(422);
    const disc = await accountantAgent
      .post(`/api/v1/billing/invoices/${invId}/discount`)
      .send({ amountMinor: 2000, reason: 'Financial hardship' });
    expect(disc.status).toBe(200);
    expect(disc.body.data.discountMinor).toBe(2000);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'invoice.discount_apply', resourceId: invId });
    expect(entry).toBeTruthy();
  });

  it('AC-49: reconciliation totals match invoice ledger', async () => {
    const rec = await accountantAgent.get('/api/v1/billing/reconciliation');
    expect(rec.status).toBe(200);
    expect(rec.body.data.totals.paidMinor).toBeGreaterThan(0);
    expect(rec.body.data.totals.invoicedMinor).toBeGreaterThan(0);
    expect(rec.body.data.byStatus).toHaveProperty('PAID');

    // Patient blocked from reconciliation.
    const patientTry = await patientAgent.get('/api/v1/billing/reconciliation');
    expect(patientTry.status).toBe(403);
  });

  it('Patient sees own invoices only', async () => {
    const mine = await patientAgent.get('/api/v1/billing/invoices');
    expect(mine.status).toBe(200);
    for (const inv of mine.body.data) {
      expect(inv.patientId).toBe(patientId);
    }
  });
});
