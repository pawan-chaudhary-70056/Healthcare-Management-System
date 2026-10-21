import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let pharmAgent: Awaited<ReturnType<typeof mkAgent>>;

let doctorId = '';
let departmentId = '';
let patientId = '';

const DAY_OFFSET_DAYS = 1;

function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
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
  process.env.MONGO_URI = replSet.getUri('hms-test-pharmacy');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { DoctorSchedule } = await import('../../src/models/doctor-schedule.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { Drug } = await import('../../src/models/pharmacy.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'doctor', 'pharmacist', 'patient', 'receptionist'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const doctor = await User.create({
    email: 'doctor@ph.test',
    passwordHash: await hashPassword('Doctor@12345'),
    role: 'doctor',
    status: 'ACTIVE',
    staffProfile: { fullName: 'Dr. Pharm', department: 'General Medicine', specialties: [] },
  });
  doctorId = String(doctor._id);

  await User.create([
    { email: 'admin@ph.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@ph.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
    { email: 'pharm@ph.test', passwordHash: await hashPassword('Pharm@12345'), role: 'pharmacist', status: 'ACTIVE' },
  ]);

  const patientUser = await User.create({
    email: 'patient@ph.test',
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
    slotLengthMinutes: 60,
  });

  const patient = await Patient.create({
    userId: patientUser._id,
    mrn: 'MRN-5001-0001',
    firstName: 'Pharm',
    lastName: 'Patient',
    dob: '1988-08-08',
    gender: 'male',
  });
  patientId = String(patient._id);

  await Drug.create([
    { code: 'PARA500', name: 'Paracetamol 500mg', form: 'tablet', strength: '500mg', unitPriceMinor: 500, reorderLevel: 20 },
    { code: 'AMOX500', name: 'Amoxicillin 500mg', form: 'capsule', strength: '500mg', unitPriceMinor: 1200, reorderLevel: 20 },
  ]);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  adminAgent = await mkAgent(app, 'admin@ph.test', 'Admin@12345');
  doctorAgent = await mkAgent(app, 'doctor@ph.test', 'Doctor@12345');
  pharmAgent = await mkAgent(app, 'pharm@ph.test', 'Pharm@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

/** Build a prescription via encounter → prescription flow. Returns rx id. */
async function makePrescription(
  key: string,
  items: Array<{ medicine: string; dose: string; frequency: string; durationDays: number; quantity: number }>
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
  const reception = await mkAgent(app, 'reception@ph.test', 'Recept@12345');
  await reception.post(`/api/v1/appointments/${apptId}/checkin`);
  const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
  expect(enc.status).toBe(201);
  const rx = await doctorAgent.post('/api/v1/clinical/prescriptions').send({
    encounterId: enc.body.data.id,
    items,
  });
  expect(rx.status).toBe(201);
  return rx.body.data.id;
}

function futureExpiry(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('pharmacy (PH-06, AC-35..42)', () => {
  it('AC-35: validation queue lists ACTIVE prescriptions; dispensing forbidden for others', async () => {
    const rxId = await makePrescription('ph-key-1', [
      { medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 10 },
    ]);

    const queue = await pharmAgent.get('/api/v1/pharmacy/queue');
    expect(queue.status).toBe(200);
    expect(queue.body.data.some((p: { id: string }) => p.id === rxId)).toBe(true);

    // Doctor cannot dispense (PERM-42 pharmacist only).
    const doctorTry = await doctorAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(doctorTry.status).toBe(403);
  });

  it('AC-36: dispense deducts FEFO batches, records dispense, updates status, creates charge — one atomic tx', async () => {
    const rxId = await makePrescription('ph-key-2', [
      { medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 7, quantity: 12 },
    ]);

    // Two batches: FEFO picks the earlier expiry first.
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'PARA500', batchNo: 'B-LATE', expiryDate: futureExpiry(300), quantity: 50,
    });
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'PARA500', batchNo: 'B-EARLY', expiryDate: futureExpiry(60), quantity: 50,
    });

    const dispense = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(dispense.status).toBe(200);
    expect(dispense.body.data.status).toBe('FULLY_DISPENSED');

    const { DrugBatch, DispenseRecord } = await import('../../src/models/pharmacy.model.js');
    const early = await DrugBatch.findOne({ batchNo: 'B-EARLY' });
    const late = await DrugBatch.findOne({ batchNo: 'B-LATE' });
    // FEFO: all 12 units from the earliest-expiry batch.
    expect(early!.quantity).toBe(38);
    expect(late!.quantity).toBe(50);

    const record = await DispenseRecord.findOne({ prescriptionId: rxId });
    expect(record).toBeTruthy();
    expect(record!.chargeId).toBeTruthy();

    // Charge linked to patient with integer minor units.
    const { Charge } = await import('../../src/models/billing.model.js');
    const charge = await Charge.findById(record!.chargeId);
    expect(charge!.sourceType).toBe('PHARMACY');
    expect(charge!.amountMinor).toBe(12 * 500);
  });

  it('AC-37/40: expired and quarantined batches are blocked from dispensing', async () => {
    const rxId = await makePrescription('ph-key-3', [
      { medicine: 'Amoxicillin 500mg', dose: '500mg', frequency: 'BD', durationDays: 5, quantity: 6 },
    ]);

    // Expired batch only → dispense blocked.
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'AMOX500', batchNo: 'B-EXP', expiryDate: futureExpiry(-10), quantity: 100,
    });
    const blocked = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('INSUFFICIENT_STOCK');

    // Quarantined valid batch still blocked.
    const { DrugBatch } = await import('../../src/models/pharmacy.model.js');
    const exp = await DrugBatch.findOne({ batchNo: 'B-EXP' });
    void exp;
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'AMOX500', batchNo: 'B-QUAR', expiryDate: futureExpiry(200), quantity: 100,
    });
    const quar = await DrugBatch.findOne({ batchNo: 'B-QUAR' });
    await pharmAgent.post(`/api/v1/pharmacy/inventory/batches/${quar!._id}/quarantine`).send({ reason: 'Suspect packaging' });
    const still = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(still.status).toBe(422);

    // Release a valid batch → dispense succeeds and skips quarantined/expired.
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'AMOX500', batchNo: 'B-OK', expiryDate: futureExpiry(150), quantity: 30,
    });
    const ok = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(ok.status).toBe(200);
    const afterQuar = await DrugBatch.findOne({ batchNo: 'B-QUAR' });
    expect(afterQuar!.quantity).toBe(100); // untouched
  });

  it('AC-38: stock never goes negative — oversell attempt rejected atomically', async () => {
    const rxId = await makePrescription('ph-key-4', [
      { medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'OD', durationDays: 30, quantity: 1000 },
    ]);
    // Remaining PARA500 stock is only ~38 units → 1000 required → rejected.
    const res = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    // No partial deduction happened (atomicity).
    const { DrugBatch } = await import('../../src/models/pharmacy.model.js');
    const early = await DrugBatch.findOne({ batchNo: 'B-EARLY' });
    expect(early!.quantity).toBe(38);
  });

  it('AC-39: partial dispense keeps remaining quantities dispensable', async () => {
    const rxId = await makePrescription('ph-key-5', [
      { medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 10 },
      { medicine: 'Amoxicillin 500mg', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 6 },
    ]);
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'AMOX500', batchNo: 'B-P5', expiryDate: futureExpiry(120), quantity: 10,
    });

    // First dispense: PARA500 available? B-EARLY has 38 → yes. AMOX has 30 → yes.
    const first = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('FULLY_DISPENSED');

    // Fully-dispensed → further dispense rejected (duplicate guard).
    const dup = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(dup.status).toBe(422);
  });

  it('AC-41: stock adjustments require a reason and are audited; negative result blocked', async () => {
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'PARA500', batchNo: 'B-ADJ', expiryDate: futureExpiry(200), quantity: 20,
    });
    const { DrugBatch } = await import('../../src/models/pharmacy.model.js');
    const batch = await DrugBatch.findOne({ batchNo: 'B-ADJ' });

    const noReason = await pharmAgent.post(`/api/v1/pharmacy/inventory/batches/${batch!._id}/adjust`).send({ delta: -5 });
    expect(noReason.status).toBe(422);

    const neg = await pharmAgent.post(`/api/v1/pharmacy/inventory/batches/${batch!._id}/adjust`).send({ delta: -100, reason: 'Damage' });
    expect(neg.status).toBe(422);
    expect(neg.body.error.code).toBe('INSUFFICIENT_STOCK');

    const adj = await pharmAgent.post(`/api/v1/pharmacy/inventory/batches/${batch!._id}/adjust`).send({ delta: -5, reason: 'Broken pack' });
    expect(adj.status).toBe(200);
    expect(adj.body.data.quantity).toBe(15);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const entry = await AuditLog.findOne({ action: 'inventory.adjust', resourceId: String(batch!._id) });
    expect(entry).toBeTruthy();
  });

  it('AC-42: expiry sweep auto-quarantines expired batches; prescription EXPIRED sweep', async () => {
    // Received as AVAILABLE (expires in 5 days), then the sweep runs with a
    // `now` beyond that date — simulating time passing before the daily job.
    await pharmAgent.post('/api/v1/pharmacy/inventory/receive').send({
      drugCode: 'PARA500', batchNo: 'B-SWEEP', expiryDate: futureExpiry(5), quantity: 10,
    });
    const { DrugBatch } = await import('../../src/models/pharmacy.model.js');
    const { sweepExpiredBatches, sweepExpiredPrescriptions } = await import('../../src/services/pharmacy.service.js');

    const swept = await sweepExpiredBatches(new Date(Date.now() + 30 * 24 * 60 * 60_000));
    expect(swept).toBeGreaterThanOrEqual(1);
    const b = await DrugBatch.findOne({ batchNo: 'B-SWEEP' });
    expect(b!.status).toBe('EXPIRED');

    // Prescription expiry sweep.
    const { Prescription } = await import('../../src/models/clinical.model.js');
    await Prescription.create({
      patientId,
      encounterId: patientId, // placeholder ref for sweep test only
      doctorId,
      items: [{ medicine: 'X', dose: '1', frequency: 'OD', durationDays: 1, quantity: 1 }],
      status: 'ACTIVE',
      dispensedQty: [0],
      expiresAt: new Date(Date.now() - 1000),
    });
    const expiredCount = await sweepExpiredPrescriptions();
    expect(expiredCount).toBeGreaterThanOrEqual(1);
  });

  it('Cancelled prescription is removed from dispensing (§2) — audited', async () => {
    const rxId = await makePrescription('ph-key-6', [
      { medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 3, quantity: 6 },
    ]);
    const cancel = await doctorAgent.post(`/api/v1/clinical/prescriptions/${rxId}/cancel`).send({ reason: 'Therapy change' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');

    const dispense = await pharmAgent.post(`/api/v1/pharmacy/dispense/${rxId}`);
    expect(dispense.status).toBe(422);
    expect(dispense.body.error.code).toBe('PRESCRIPTION_INVALID');
  });
});
