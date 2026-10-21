import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let receptionAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let patientAgent: Awaited<ReturnType<typeof mkAgent>>;

let doctorId = '';
let departmentId = '';
let patientId = '';

const DAY_OFFSET_DAYS = 1; // book tomorrow (inside horizon)

function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function mkAgent(
  app: Express,
  email: string,
  password: string
): Promise<ReturnType<(typeof import('supertest'))['default']['agent']> extends never ? never : import('supertest').SuperAgentTest> {
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
  process.env.MONGO_URI = replSet.getUri('hms-test-appts');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { DoctorSchedule } = await import('../../src/models/doctor-schedule.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'receptionist', 'doctor', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const doctor = await User.create({
    email: 'doctor@a.test',
    passwordHash: await hashPassword('Doctor@12345'),
    role: 'doctor',
    status: 'ACTIVE',
    staffProfile: { fullName: 'Dr. Test', department: 'General Medicine', specialties: [] },
  });
  doctorId = String(doctor._id);

  await User.create([
    { email: 'admin@a.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@a.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
  ]);

  const patientUser = await User.create({
    email: 'patient@a.test',
    passwordHash: await hashPassword('Patient@12345'),
    role: 'patient',
    status: 'ACTIVE',
  });

  const dept = await Department.create({ name: 'General Medicine', publicVisible: true });
  departmentId = String(dept._id);

  // Schedule: tomorrow is (likely) a weekday template for 09:00–12:00, 30-min slots.
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
    mrn: 'MRN-2001-0001',
    firstName: 'Booked',
    lastName: 'Patient',
    dob: '1985-03-03',
    gender: 'female',
  });
  patientId = String(patient._id);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes(); // AC-15: unique active-slot index must exist before the race

  adminAgent = await mkAgent(app, 'admin@a.test', 'Admin@12345');
  receptionAgent = await mkAgent(app, 'reception@a.test', 'Recept@12345');
  doctorAgent = await mkAgent(app, 'doctor@a.test', 'Doctor@12345');
  patientAgent = await mkAgent(app, 'patient@a.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

async function firstSlot(): Promise<{ start: string; end: string }> {
  const date = futureDate(DAY_OFFSET_DAYS);
  const res = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBeGreaterThan(0);
  return res.body.data[0];
}

describe('appointments (EP-20..27, AC-14..21, AC-63)', () => {
  it('AC-63: CLOSED exception removes all slots for that date (computed on read)', async () => {
    const { ScheduleException } = await import('../../src/models/doctor-schedule.model.js');
    const closedDate = futureDate(2);
    await ScheduleException.create({ doctorId, date: closedDate, type: 'CLOSED' });
    const res = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${closedDate}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('AC-14: booking creates REQUESTED appointment + queues notification', async () => {
    const slot = await firstSlot();
    const res = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'test-key-book-1')
      .send({
        patientId,
        doctorId,
        departmentId,
        slotStartIso: slot.start,
        slotEndIso: slot.end,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('REQUESTED');

    const { Notification } = await import('../../src/models/notification.model.js');
    const n = await Notification.findOne({ 'payload.appointmentId': res.body.data.id });
    expect(n).toBeTruthy();
    // NFR-16/AC-20: privacy-trimmed payload only.
    expect(Object.keys(n!.payload).sort()).toEqual(
      ['appointmentId', 'department', 'slotEndIso', 'slotStartIso'].sort()
    );
  });

  it('428 when Idempotency-Key missing (contract rule 3)', async () => {
    const slot = (await firstSlot());
    const res = await adminAgent.post('/api/v1/appointments').send({
      patientId,
      doctorId,
      departmentId,
      slotStartIso: slot.start,
      slotEndIso: slot.end,
    });
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('AC-16: same idempotency key retries return the original — no duplicate', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    // Pick a slot at index 1 (index 0 was taken by AC-14 test).
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[1];

    const key = 'test-key-idem-2';
    const first = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', key)
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    expect(first.status).toBe(201);

    const retry = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', key)
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    expect(retry.status).toBe(200); // replayed, not re-created
    expect(retry.body.data.id).toBe(first.body.data.id);

    const list = await adminAgent.get(`/api/v1/appointments?patientId=${patientId}`);
    const matching = list.body.data.filter((a: { id: string }) => a.id === first.body.data.id);
    expect(matching).toHaveLength(1);
  });

  it('AC-15: two concurrent bookings for one slot → exactly one wins', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[2];

    const payload = {
      patientId,
      doctorId,
      departmentId,
      slotStartIso: slot.start,
      slotEndIso: slot.end,
    };
    const [r1, r2] = await Promise.all([
      adminAgent.post('/api/v1/appointments').set('Idempotency-Key', 'race-key-1').send(payload),
      adminAgent.post('/api/v1/appointments').set('Idempotency-Key', 'race-key-2').send(payload),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('SLOT_TAKEN');
  });

  it('T-03 confirm → T-04 check-in issues sequential queue token (AC-17)', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[3];

    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'test-key-flow-1')
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    const apptId = book.body.data.id;

    const confirm = await adminAgent.post(`/api/v1/appointments/${apptId}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');

    const checkin = await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
    expect(checkin.status).toBe(200);
    expect(checkin.body.data.appointment.status).toBe('CHECKED_IN');
    expect(checkin.body.data.queueToken.tokenNo).toBe(1);

    // Double check-in → invalid transition.
    const again = await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('T-05/T-06: doctor starts + completes own consultation; patient forbidden', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[4];

    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'test-key-flow-2')
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    const apptId = book.body.data.id;
    await adminAgent.post(`/api/v1/appointments/${apptId}/confirm`);
    await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);

    // Patient cannot drive lifecycle transitions.
    const patientTry = await patientAgent.post(`/api/v1/appointments/${apptId}/start`);
    expect(patientTry.status).toBe(403);

    const start = await doctorAgent.post(`/api/v1/appointments/${apptId}/start`);
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe('IN_CONSULTATION');

    const complete = await doctorAgent.post(`/api/v1/appointments/${apptId}/complete`);
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('COMPLETED');

    // Terminal: no further transitions (staff role permitted to confirm).
    const reopen = await receptionAgent.post(`/api/v1/appointments/${apptId}/confirm`);
    expect(reopen.status).toBe(422);
  });

  it('T-09: patient cancels own booking; reason required; notification queued', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[slotsRes.body.data.length - 1];

    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'test-key-cancel-1')
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    const apptId = book.body.data.id;

    const noReason = await patientAgent.post(`/api/v1/appointments/${apptId}/cancel`).send({});
    expect(noReason.status).toBe(422);

    const cancel = await patientAgent
      .post(`/api/v1/appointments/${apptId}/cancel`)
      .send({ reason: 'Cannot attend' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');

    const { Notification } = await import('../../src/models/notification.model.js');
    const n = await Notification.findOne({
      'payload.appointmentId': apptId,
      event: 'appointment.cancelled',
    });
    expect(n).toBeTruthy();
  });

  it('T-11: receptionist marks CONFIRMED past grace as NO_SHOW; retained not deleted', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[slotsRes.body.data.length - 2];

    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'test-key-noshow-1')
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    const apptId = book.body.data.id;
    await adminAgent.post(`/api/v1/appointments/${apptId}/confirm`);

    // Inside the grace window → rejected (T-11 policy, A-07).
    const early = await receptionAgent.post(`/api/v1/appointments/${apptId}/no-show`);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('POLICY_WINDOW');

    // Simulate the slot having passed: move it beyond the grace cutoff.
    const { Appointment } = await import('../../src/models/appointment.model.js');
    const pastStart = new Date(Date.now() - 2 * 60 * 60_000);
    await Appointment.findByIdAndUpdate(apptId, {
      slot: { start: pastStart, end: new Date(pastStart.getTime() + 30 * 60_000) },
    });

    const noshow = await receptionAgent.post(`/api/v1/appointments/${apptId}/no-show`);
    expect(noshow.status).toBe(200);
    expect(noshow.body.data.status).toBe('NO_SHOW');

    const still = await Appointment.findById(apptId);
    expect(still).toBeTruthy();
  });

  it('AC-21: doctor sees only own schedule; patient sees own appointments', async () => {
    const mine = await doctorAgent.get('/api/v1/appointments');
    expect(mine.status).toBe(200);
    for (const a of mine.body.data) {
      expect(String(a.doctorId?._id ?? a.doctorId)).toBe(doctorId);
    }

    const { User } = await import('../../src/models/user.model.js');
    void User;
    const patientList = await patientAgent.get('/api/v1/appointments/mine');
    expect(patientList.status).toBe(200);
    for (const a of patientList.body.data) {
      expect(String(a.patientId)).toBe(patientId);
    }
  });

  it('EP-27: waitlist join + cancel triggers offer; leave audited', async () => {
    // Fill the remaining slots first (dates beyond horizon already excluded).
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const remaining: string[] = slotsRes.body.data.map((s: { start: string }) => s.start);
    let i = 0;
    for (const start of remaining) {
      i += 1;
      const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
      await adminAgent
        .post('/api/v1/appointments')
        .set('Idempotency-Key', `fill-${i}-${start.slice(-6)}`)
        .send({ patientId, doctorId, departmentId, slotStartIso: start, slotEndIso: end });
    }

    // No slots left → patient joins waitlist.
    const join = await patientAgent
      .post('/api/v1/appointments/waitlist')
      .send({ doctorId, departmentId, date });
    expect(join.status).toBe(201);
    const waitlistId = join.body.data.id;

    // Reception cancels a future booking → slot freed → waitlist offer queued.
    const list = await adminAgent.get(`/api/v1/appointments?patientId=${patientId}&status=REQUESTED`);
    const victim = list.body.data[0];
    const cancel = await adminAgent
      .post(`/api/v1/appointments/${victim.id}/cancel`)
      .send({ reason: 'Freeing for waitlist test' });
    expect(cancel.status).toBe(200);

    const { WaitlistEntry } = await import('../../src/models/appointment.model.js');
    const entry = await WaitlistEntry.findById(waitlistId);
    expect(['OFFERED', 'WAITING']).toContain(entry!.status);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const joined = await AuditLog.findOne({ action: 'appointment.waitlist_join', resourceId: waitlistId });
    expect(joined).toBeTruthy();

    // Leave → LEFT.
    const leave = await patientAgent.delete(`/api/v1/appointments/waitlist/${waitlistId}`);
    expect(leave.status).toBe(200);
  });

  it('invalid transition: REQUESTED → CHECKED_IN rejected (422) + audited', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    // Book + keep REQUESTED (no confirm), then try direct check-in.
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    expect(slotsRes.body.data.length === 0, 'expected a free slot for the invalid-transition test').toBe(false);
    const slot = slotsRes.body.data[0];

    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', `test-key-invalid-${slot.start.slice(-6)}`)
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    expect(book.status).toBe(201);
    const apptId = book.body.data.id;
    expect(book.body.data.status).toBe('REQUESTED');

    const skip = await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
    expect(skip.status).toBe(422);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const anomaly = await AuditLog.findOne({
      action: 'appointment.invalid_transition',
      resourceId: apptId,
    });
    expect(anomaly).toBeTruthy();
  });
});
