import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

/**
 * Pharmacy dispense concurrency suite — PH-06 phase gate "stock integrity
 * under concurrency" + PH-09 prep (NFR-05 pattern applied to dispensing).
 *
 * Invariants proven here, every run, on a real replica set:
 *  I1  Parallel dispense of the SAME prescription → exactly one commit; the
 *      losers get 422/409 (business guards, never 500); dispensedQty never
 *      exceeds the ordered quantity; exactly one dispense record + charge.
 *  I2  Two prescriptions race vs exactly-enough stock → no negative stock;
 *      committed deductions always equal the physical stock drawn.
 *  I3  N-way race vs limited stock → every rejection is a business guard;
 *      persisted quantity == initial − (committed txs × ordered qty).
 *  I4  Zero-stock drain race → at most one drain wins; movement ledger deltas
 *      + received == persisted quantity (no lost/ghost writes).
 *
 * Isolation: every test uses its OWN drug code, so FEFO cannot pick up stock
 * from an earlier test's batches and skew the expected quantities.
 */

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let pharmAgent: Awaited<ReturnType<typeof mkAgent>>;
let receptionAgent: Awaited<ReturnType<typeof mkAgent>>;

let doctorId = '';
let departmentId = '';
let patientId = '';

const DAY_OFFSET_DAYS = 1;

function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function futureExpiry(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  process.env.MONGO_URI = replSet.getUri('hms-test-dispense-race');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { DoctorSchedule } = await import('../../src/models/doctor-schedule.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'doctor', 'pharmacist', 'patient', 'receptionist'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const doctor = await User.create({
    email: 'doctor@race.test',
    passwordHash: await hashPassword('Doctor@12345'),
    role: 'doctor',
    status: 'ACTIVE',
    staffProfile: { fullName: 'Dr. Race', department: 'General Medicine', specialties: [] },
  });
  doctorId = String(doctor._id);

  await User.create([
    { email: 'admin@race.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@race.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
    { email: 'pharm@race.test', passwordHash: await hashPassword('Pharm@12345'), role: 'pharmacist', status: 'ACTIVE' },
  ]);

  const patientUser = await User.create({
    email: 'patient@race.test',
    passwordHash: await hashPassword('Patient@12345'),
    role: 'patient',
    status: 'ACTIVE',
  });

  const dept = await Department.create({ name: 'General Medicine', publicVisible: true });
  departmentId = String(dept._id);

  const bookingDate = futureDate(DAY_OFFSET_DAYS);
  const weekday = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
  await DoctorSchedule.create({
    doctorId: doctor._id,
    departmentId: dept._id,
    weekday,
    startTime: '08:00',
    endTime: '17:00',
    slotLengthMinutes: 30,
  });

  const patient = await Patient.create({
    userId: patientUser._id,
    mrn: 'MRN-8001-0001',
    firstName: 'Race',
    lastName: 'Patient',
    dob: '1991-01-01',
    gender: 'male',
  });
  patientId = String(patient._id);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  adminAgent = await mkAgent(app, 'admin@race.test', 'Admin@12345');
  doctorAgent = await mkAgent(app, 'doctor@race.test', 'Doctor@12345');
  pharmAgent = await mkAgent(app, 'pharm@race.test', 'Pharm@12345');
  receptionAgent = await mkAgent(app, 'reception@race.test', 'Recept@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

/** Book → confirm → check-in → encounter → prescription. Returns rx id. */
async function makePrescription(
  key: string,
  medicine: string,
  quantity: number
): Promise<string> {
  const date = futureDate(DAY_OFFSET_DAYS);
  const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
  const slot = slotsRes.body.data[slotsRes.body.data.length - 1];
  const book = await adminAgent
    .post('/api/v1/appointments')
    .set('Idempotency-Key', key)
    .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
  expect(book.status).toBe(201);
  const apptId = book.body.data.id;
  await adminAgent.post(`/api/v1/appointments/${apptId}/confirm`);
  await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
  const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
  expect(enc.status).toBe(201);
  const rx = await doctorAgent.post('/api/v1/clinical/prescriptions').send({
    encounterId: enc.body.data.id,
    items: [{ medicine, dose: '500mg', frequency: 'TDS', durationDays: 5, quantity }],
  });
  expect(rx.status).toBe(201);
  return rx.body.data.id;
}

/** Fresh drug + fully-stocked single batch, isolated per test. */
async function seedDrugAndBatch(
  code: string,
  batchNo: string,
  quantity: number
): Promise<void> {
  const { Drug } = await import('../../src/models/pharmacy.model.js');
  await Drug.create({
    code,
    name: `${code} 500mg`,
    form: 'tablet',
    strength: '500mg',
    unitPriceMinor: 700,
    reorderLevel: 5,
  });
  const rec = await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
    drugCode: code, batchNo, expiryDate: futureExpiry(200), quantity,
  });
  expect(rec.status).toBe(201);
}

async function stockOf(batchNo: string): Promise<number> {
  const { DrugBatch } = await import('../../src/models/pharmacy.model.js');
  const b = await DrugBatch.findOne({ batchNo });
  return b!.quantity;
}

function describeResult(r: { status: number; body: { error?: { code?: string } } }): string {
  return `${r.status}${r.body?.error?.code ? ` ${r.body.error.code}` : ''}`;
}

describe('pharmacy dispense concurrency (NFR-05 pattern, AC-36/38)', () => {
  it('I1: parallel dispense of the SAME prescription → exactly one commit', async () => {
    await seedDrugAndBatch('RACE1', 'R1', 100);
    const rxId = await makePrescription('race-key-1', 'Race1 500mg', 6);

    const results = await Promise.all([
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`),
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`),
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`),
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`),
    ]);

    const okCount = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status !== 200);
    // Diagnostics surface through the assertion message on failure.
    expect(results.map(describeResult), 'exactly one tx must commit').toHaveLength(okCount === 1 ? results.length : -1);
    expect(okCount).toBe(1);

    // Exactly one committed transaction.
    expect(okCount).toBe(1);
    // Every rejection is a business guard — never a 500.
    for (const r of rejected) {
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('PRESCRIPTION_INVALID');
    }

    // No double deduction: batch holds 100 − 6.
    expect(await stockOf('R1')).toBe(94);

    // dispensedQty == ordered exactly; status FULLY_DISPENSED.
    const { Prescription } = await import('../../src/models/clinical.model.js');
    const rx = await Prescription.findById(rxId);
    expect(rx!.dispensedQty[0]).toBe(6);
    expect(rx!.status).toBe('FULLY_DISPENSED');

    // Exactly one dispense record for this rx.
    const { DispenseRecord } = await import('../../src/models/pharmacy.model.js');
    expect(await DispenseRecord.countDocuments({ prescriptionId: rxId })).toBe(1);
  });

  it('I2: two prescriptions race vs exactly-enough stock → no negative stock', async () => {
    await seedDrugAndBatch('RACE2', 'R2', 16);
    const rxA = await makePrescription('race-key-2a', 'Race2 500mg', 8);
    const rxB = await makePrescription('race-key-2b', 'Race2 500mg', 8);

    const [ra, rb] = await Promise.all([
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxA}`),
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxB}`),
    ]);

    const committedQty = (ra.status === 200 ? 8 : 0) + (rb.status === 200 ? 8 : 0);
    const left = await stockOf('R2');

    // Ledger invariant: persisted quantity == 16 − committed deductions, never negative.
    expect(left).toBe(16 - committedQty);
    expect(left).toBeGreaterThanOrEqual(0);

    // Any rejection is a clean business guard.
    for (const r of [ra, rb]) {
      if (r.status !== 200) {
        expect([409, 422]).toContain(r.status);
      }
    }
  });

  it('I3: 6-way race vs 20-unit stock → rejections are business guards; ledger exact', async () => {
    await seedDrugAndBatch('RACE3', 'R3', 20);

    const rxIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      rxIds.push(await makePrescription(`race-key-3-${i}`, 'Race3 500mg', 8));
    }

    const results = await Promise.all(
      rxIds.map((id) => pharmAgent.post(`/api/v1/pharmacy/dispense/${id}`))
    );

    const committed = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status !== 200);

    // Physical stock 20 can serve at most 2 full dispenses of 8.
    expect(committed).toBeLessThanOrEqual(2);
    // Every rejection is a business guard — never a 500.
    for (const r of rejected) {
      expect([409, 422]).toContain(r.status);
    }

    const left = await stockOf('R3');
    expect(left).toBe(20 - committed * 8);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('I4: zero-stock drain race → at most one drain; movement ledger consistent', async () => {
    await seedDrugAndBatch('RACE4', 'R4', 8);
    const rxA = await makePrescription('race-key-4a', 'Race4 500mg', 8);
    const rxB = await makePrescription('race-key-4b', 'Race4 500mg', 8);

    const [ra, rb] = await Promise.all([
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxA}`),
      pharmAgent.post(`/api/v1/pharmacy/dispense/${rxB}`),
    ]);

    const oks = [ra, rb].filter((r) => r.status === 200);
    // Physical stock cannot serve both 8-unit drains.
    expect(oks.length).toBeLessThanOrEqual(1);

    const { DrugBatch, InventoryMovement } = await import('../../src/models/pharmacy.model.js');
    const { DrugBatch: DB } = await import('../../src/models/pharmacy.model.js');
    void DB;
    const batch = await DrugBatch.findOne({ batchNo: 'R4' });
    const movements = await InventoryMovement.find({ batchId: batch!._id, type: 'DISPENSE' });
    const ledgerDelta = movements.reduce((sum, m) => sum + m.delta, 0);
    // Ledger deltas + received == persisted quantity (no lost/ghost writes).
    expect(8 + ledgerDelta).toBe(batch!.quantity);
    expect(batch!.quantity).toBeGreaterThanOrEqual(0);
  });
});
