import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let tech1Agent: Awaited<ReturnType<typeof mkAgent>>;
let tech2Agent: Awaited<ReturnType<typeof mkAgent>>;
let patientAgent: Awaited<ReturnType<typeof mkAgent>>;

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
  process.env.MONGO_URI = replSet.getUri('hms-test-lab');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { DoctorSchedule } = await import('../../src/models/doctor-schedule.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { LabTest } = await import('../../src/models/lab.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'doctor', 'lab_tech', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const doctor = await User.create({
    email: 'doctor@l.test',
    passwordHash: await hashPassword('Doctor@12345'),
    role: 'doctor',
    status: 'ACTIVE',
    staffProfile: { fullName: 'Dr. Lab', department: 'Pathology', specialties: [] },
  });
  doctorId = String(doctor._id);

  await User.create([
    { email: 'admin@l.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@l.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
    { email: 'tech1@l.test', passwordHash: await hashPassword('Tech@12345'), role: 'lab_tech', status: 'ACTIVE' },
    { email: 'tech2@l.test', passwordHash: await hashPassword('Tech@12345'), role: 'lab_tech', status: 'ACTIVE' },
  ]);

  const patientUser = await User.create({
    email: 'patient@l.test',
    passwordHash: await hashPassword('Patient@12345'),
    role: 'patient',
    status: 'ACTIVE',
  });

  const dept = await Department.create({ name: 'Pathology', publicVisible: true });
  departmentId = String(dept._id);

  const patient = await Patient.create({
    userId: patientUser._id,
    mrn: 'MRN-4001-0001',
    firstName: 'Lab',
    lastName: 'Patient',
    dob: '1992-02-02',
    gender: 'female',
    assignedDoctorIds: [doctor._id],
  });
  patientId = String(patient._id);

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

  await LabTest.create([
    {
      code: 'CBC',
      name: 'Complete Blood Count',
      priceMinor: 25000,
      criticalRules: [{ name: 'hemoglobin', min: 4, max: 20, unit: 'g/dL' }],
    },
    {
      code: 'GLU',
      name: 'Fasting Glucose',
      priceMinor: 12000,
      criticalRules: [{ name: 'glucose', min: 40, max: 450, unit: 'mg/dL' }],
    },
  ]);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  adminAgent = await mkAgent(app, 'admin@l.test', 'Admin@12345');
  doctorAgent = await mkAgent(app, 'doctor@l.test', 'Doctor@12345');
  tech1Agent = await mkAgent(app, 'tech1@l.test', 'Tech@12345');
  tech2Agent = await mkAgent(app, 'tech2@l.test', 'Tech@12345');
  patientAgent = await mkAgent(app, 'patient@l.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

/** Build a CHECKED_IN appointment + OPEN encounter owned by the doctor. */
async function openEncounter(key: string): Promise<string> {
  const { QueueToken } = await import('../../src/models/appointment.model.js');
  void QueueToken;
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
  const supertest = await import('supertest');
  const receptionAgent = supertest.default.agent(app);
  await receptionAgent.post('/api/v1/auth/login').send({ email: 'reception@l.test', password: 'Recept@12345' });
  await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
  const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
  expect(enc.status).toBe(201);
  return enc.body.data.id;
}

describe('lab (PH-05, AC-28..34)', () => {
  it('AC-28/34: doctor creates order on own encounter; charge auto-linked', async () => {
    const encId = await openEncounter('lab-key-1');
    const res = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'CBC' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ORDERED');

    const { Charge } = await import('../../src/models/billing.model.js');
    const charge = await Charge.findById(res.body.data.chargeId);
    expect(charge).toBeTruthy();
    expect(charge!.amountMinor).toBe(25000);
    expect(charge!.sourceType).toBe('LAB');
  });

  it('Doctor cannot order on another doctor encounter (R-01)', async () => {
    const encId = await openEncounter('lab-key-2');
    const { User } = await import('../../src/models/user.model.js');
    const { hashPassword } = await import('../../src/utils/hash.js');
    const other = await User.create({
      email: 'doctor9@l.test',
      passwordHash: await hashPassword('Doctor@12345'),
      role: 'doctor',
      status: 'ACTIVE',
    });
    const supertest = await import('supertest');
    const otherAgent = supertest.default.agent(app);
    await otherAgent.post('/api/v1/auth/login').send({ email: 'doctor9@l.test', password: 'Doctor@12345' });
    const res = await otherAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'CBC' });
    expect(res.status).toBe(403);
    void other;
  });

  it('AC-29: specimen recording + custody by lab_tech; doctor forbidden', async () => {
    const encId = await openEncounter('lab-key-3');
    const order = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'GLU' });
    const orderId = order.body.data.id;

    const doctorTry = await doctorAgent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({
      specimenId: 'SP-001',
      type: 'blood',
    });
    expect(doctorTry.status).toBe(403);

    const rec = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({
      specimenId: 'SP-001',
      type: 'blood',
    });
    expect(rec.status).toBe(200);
    expect(rec.body.data.status).toBe('SPECIMEN_COLLECTED');

    const custody = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/custody`).send({ action: 'TRANSFERRED_TO_ANALYZER' });
    expect(custody.status).toBe(200);

    // Double specimen → invalid transition.
    const again = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({ specimenId: 'SP-002', type: 'blood' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('AC-30/31: entry by tech1, verification by tech2 (separable duties); unverified invisible to patient', async () => {
    const encId = await openEncounter('lab-key-4');
    const order = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'CBC' });
    const orderId = order.body.data.id;
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({ specimenId: 'SP-004', type: 'blood' });

    const entered = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/results`).send({
      values: [{ name: 'hemoglobin', value: '13.5', unit: 'g/dL', flag: 'normal' }],
    });
    expect(entered.status).toBe(200);
    expect(entered.body.data.status).toBe('RESULT_ENTERED');

    // Same tech cannot verify (separable duties).
    const selfVerify = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/verify`);
    expect(selfVerify.status).toBe(403);

    // Patient cannot see unverified results (NFR-17).
    const patientView = await patientAgent.get(`/api/v1/lab/orders/${orderId}`);
    expect(patientView.status).toBe(200);
    expect(patientView.body.data.results).toBeUndefined();

    // Different tech verifies.
    const verified = await tech2Agent.post(`/api/v1/lab/orders/${orderId}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('VERIFIED');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const verifyAudit = await AuditLog.findOne({ action: 'lab.result_verify', resourceId: orderId });
    expect(verifyAudit).toBeTruthy();
  });

  it('AC-32: critical detection → alert → release blocked until ack', async () => {
    const encId = await openEncounter('lab-key-5');
    const order = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'GLU' });
    const orderId = order.body.data.id;
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({ specimenId: 'SP-005', type: 'blood' });

    // Glucose 22 → critical per threshold (max 450, min 40).
    const entered = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/results`).send({
      values: [{ name: 'glucose', value: '22', unit: 'mg/dL' }],
    });
    expect(entered.status).toBe(200);
    expect(entered.body.data.results.isCritical).toBe(true);

    // Clinician alert notification recorded.
    const { Notification } = await import('../../src/models/notification.model.js');
    const alert = await Notification.findOne({ event: 'lab.critical_result', 'payload.orderId': orderId });
    expect(alert).toBeTruthy();

    // Verify by tech2.
    await tech2Agent.post(`/api/v1/lab/orders/${orderId}/verify`);

    // Release blocked until acknowledgment.
    const blocked = await tech2Agent.post(`/api/v1/lab/orders/${orderId}/release`).send({ releaseToPatient: false });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('CRITICAL_ACK_REQUIRED');

    const ack = await doctorAgent.post(`/api/v1/lab/orders/${orderId}/critical-ack`);
    expect(ack.status).toBe(200);

    const release = await tech2Agent.post(`/api/v1/lab/orders/${orderId}/release`).send({ releaseToPatient: false });
    expect(release.status).toBe(200);
    expect(release.body.data.status).toBe('RELEASED');
  });

  it('AC-30: released result visible to patient when releaseToPatient=true', async () => {
    const encId = await openEncounter('lab-key-6');
    const order = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'CBC' });
    const orderId = order.body.data.id;
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({ specimenId: 'SP-006', type: 'blood' });
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/results`).send({
      values: [{ name: 'hemoglobin', value: '13.2', unit: 'g/dL' }],
    });
    await tech2Agent.post(`/api/v1/lab/orders/${orderId}/verify`);
    const rel = await tech2Agent.post(`/api/v1/lab/orders/${orderId}/release`).send({ releaseToPatient: true });
    expect(rel.status).toBe(200);

    const patientView = await patientAgent.get(`/api/v1/lab/orders/${orderId}`);
    expect(patientView.status).toBe(200);
    expect(patientView.body.data.results).toBeTruthy();
    expect(patientView.body.data.results.values[0].value).toBe('13.2');

    const list = await patientAgent.get('/api/v1/lab/orders');
    expect(list.body.data.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });

  it('AC-33: amendment creates new version, requires re-verification, originals preserved', async () => {
    const encId = await openEncounter('lab-key-7');
    const order = await doctorAgent.post('/api/v1/lab/orders').send({ encounterId: encId, testCode: 'CBC' });
    const orderId = order.body.data.id;
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/specimen`).send({ specimenId: 'SP-007', type: 'blood' });
    await tech1Agent.post(`/api/v1/lab/orders/${orderId}/results`).send({
      values: [{ name: 'hemoglobin', value: '13.2', unit: 'g/dL' }],
    });
    await tech2Agent.post(`/api/v1/lab/orders/${orderId}/verify`);
    await tech2Agent.post(`/api/v1/lab/orders/${orderId}/release`).send({ releaseToPatient: true });

    // Amend with reason → status AMENDED, verification cleared.
    const amend = await tech1Agent.post(`/api/v1/lab/orders/${orderId}/amend`).send({
      values: [{ name: 'hemoglobin', value: '12.8', unit: 'g/dL' }],
      reason: 'Transcription error corrected',
    });
    expect(amend.status).toBe(200);
    expect(amend.body.data.status).toBe('AMENDED');

    // Re-verify + re-release.
    await tech2Agent.post(`/api/v1/lab/orders/${orderId}/verify`);
    const reRelease = await tech2Agent.post(`/api/v1/lab/orders/${orderId}/release`).send({ releaseToPatient: true });
    expect(reRelease.status).toBe(200);

    const { LabOrder } = await import('../../src/models/lab.model.js');
    const doc = await LabOrder.findById(orderId);
    expect(doc!.results!.versions).toHaveLength(2);
    expect(doc!.results!.versions[0].values[0].value).toBe('13.2'); // original preserved
    expect(doc!.results!.versions[1].reason).toBe('Transcription error corrected');
  });
});
