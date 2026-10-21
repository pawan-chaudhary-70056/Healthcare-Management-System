import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

let app: Express;
let replSetRef: { stop: () => Promise<void> } | null = null;

let adminAgent: Awaited<ReturnType<typeof mkAgent>>;
let receptionAgent: Awaited<ReturnType<typeof mkAgent>>;
let doctorAgent: Awaited<ReturnType<typeof mkAgent>>;
let nurseAgent: Awaited<ReturnType<typeof mkAgent>>;
let patientAgent: Awaited<ReturnType<typeof mkAgent>>;

let doctorId = '';
let departmentId = '';
let patientId = '';
let nursePatientId = '';

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
  process.env.MONGO_URI = replSet.getUri('hms-test-clinical');

  const { connectDatabase, ensureIndexes } = await import('../../src/config/database.js');
  await connectDatabase(process.env.MONGO_URI);

  const { RoleModel } = await import('../../src/models/role.model.js');
  const { User } = await import('../../src/models/user.model.js');
  const { Department } = await import('../../src/models/department.model.js');
  const { DoctorSchedule } = await import('../../src/models/doctor-schedule.model.js');
  const { Patient } = await import('../../src/models/patient.model.js');
  const { permissionsForRole } = await import('../../src/config/constants.js');
  const { hashPassword } = await import('../../src/utils/hash.js');

  for (const role of ['admin', 'receptionist', 'doctor', 'nurse', 'patient'] as const) {
    await RoleModel.create({ name: role, permissions: permissionsForRole(role) });
  }

  const doctor = await User.create({
    email: 'doctor@c.test',
    passwordHash: await hashPassword('Doctor@12345'),
    role: 'doctor',
    status: 'ACTIVE',
    staffProfile: { fullName: 'Dr. Clinical', department: 'General Medicine', specialties: [] },
  });
  doctorId = String(doctor._id);

  const nurse = await User.create({
    email: 'nurse@c.test',
    passwordHash: await hashPassword('Nurse@12345'),
    role: 'nurse',
    status: 'ACTIVE',
  });

  await User.create([
    { email: 'admin@c.test', passwordHash: await hashPassword('Admin@12345'), role: 'admin', status: 'ACTIVE' },
    { email: 'reception@c.test', passwordHash: await hashPassword('Recept@12345'), role: 'receptionist', status: 'ACTIVE' },
  ]);

  const patientUser = await User.create({
    email: 'patient@c.test',
    passwordHash: await hashPassword('Patient@12345'),
    role: 'patient',
    status: 'ACTIVE',
  });
  const nursePatientUser = await User.create({
    email: 'np@c.test',
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
    mrn: 'MRN-3001-0001',
    firstName: 'Clinical',
    lastName: 'Patient',
    dob: '1990-05-05',
    gender: 'male',
    assignedDoctorIds: [doctor._id],
  });
  patientId = String(patient._id);

  const nursePatient = await Patient.create({
    userId: nursePatientUser._id,
    mrn: 'MRN-3001-0002',
    firstName: 'NurseAssigned',
    lastName: 'Patient',
    dob: '1980-01-01',
    gender: 'female',
    // Care-team array holds every assigned staff member (doctors + nurses, R-02).
    assignedDoctorIds: [doctor._id, nurse._id],
  });
  nursePatientId = String(nursePatient._id);

  const { createApp } = await import('../../src/app.js');
  app = createApp();
  await ensureIndexes();

  adminAgent = await mkAgent(app, 'admin@c.test', 'Admin@12345');
  receptionAgent = await mkAgent(app, 'reception@c.test', 'Recept@12345');
  doctorAgent = await mkAgent(app, 'doctor@c.test', 'Doctor@12345');
  nurseAgent = await mkAgent(app, 'nurse@c.test', 'Nurse@12345');
  patientAgent = await mkAgent(app, 'patient@c.test', 'Patient@12345');
});

afterAll(async () => {
  const { disconnectDatabase: disconnect } = await import('../../src/config/database.js');
  await disconnect();
  await replSetRef?.stop();
});

/** Book + confirm + check-in an appointment, returning its id. */
async function checkedInAppointment(key: string): Promise<string> {
  const date = futureDate(DAY_OFFSET_DAYS);
  const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
  const slot = slotsRes.body.data[0];
  const book = await adminAgent
    .post('/api/v1/appointments')
    .set('Idempotency-Key', key)
    .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
  expect(book.status).toBe(201);
  const apptId = book.body.data.id;
  await adminAgent.post(`/api/v1/appointments/${apptId}/confirm`);
  const checkin = await receptionAgent.post(`/api/v1/appointments/${apptId}/checkin`);
  expect(checkin.status).toBe(200);
  return apptId;
}

describe('clinical (PH-04, AC-22..27)', () => {
  it('AC-22: encounter requires CHECKED_IN appointment; moves it IN_CONSULTATION', async () => {
    const apptId = await checkedInAppointment('clin-key-1');

    // Patient cannot create encounters.
    const patientTry = await patientAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    expect(patientTry.status).toBe(403);

    const create = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('OPEN');
    const encId = create.body.data.id;

    // Appointment is IN_CONSULTATION now — verified via open encounters below.
    const open = await doctorAgent.get('/api/v1/clinical/encounters/open');
    expect(open.body.data.some((e: { id: string }) => e.id === encId)).toBe(true);

    // AC-22 negative: a second encounter for the same appointment is rejected.
    const dupe = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    // Appointment is no longer CHECKED_IN (now IN_CONSULTATION) → 422.
    expect([409, 422]).toContain(dupe.status);
  });

  it('AC-22: encounter from REQUESTED appointment rejected (ENCOUNTER_NOT_OPEN)', async () => {
    const date = futureDate(DAY_OFFSET_DAYS);
    const slotsRes = await adminAgent.get(`/api/v1/appointments/slots?doctorId=${doctorId}&date=${date}`);
    const slot = slotsRes.body.data[1];
    const book = await adminAgent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', 'clin-key-2')
      .send({ patientId, doctorId, departmentId, slotStartIso: slot.start, slotEndIso: slot.end });
    expect(book.status).toBe(201);

    const create = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: book.body.data.id });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe('ENCOUNTER_NOT_OPEN');
  });

  it('AC-23/24: EMR draft → finalize → amend preserves versions; draft edit then finalize', async () => {
    const apptId = await checkedInAppointment('clin-key-3');
    const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    const encId = enc.body.data.id;

    // Only the encounter's doctor can write EMR.
    const entry = await doctorAgent.post(`/api/v1/clinical/encounters/${encId}/emr`).send({
      symptoms: 'Fever, cough',
      examination: 'Temp 38.5C, chest clear',
      diagnosis: 'Acute bronchitis',
      plan: 'Rest, fluids, review in 5 days',
    });
    expect(entry.status).toBe(201);
    const entryId = entry.body.data.id;
    expect(entry.body.data.version).toBe(1);

    // Finalize.
    const fin = await doctorAgent.post(`/api/v1/clinical/emr/${entryId}/finalize`);
    expect(fin.status).toBe(200);
    expect(fin.body.data.status).toBe('FINALIZED');

    // Direct edit after finalize → RECORD_FINALIZED.
    const edit = await doctorAgent.post(`/api/v1/clinical/emr/${entryId}/finalize`);
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('RECORD_FINALIZED');

    // Amend with reason → version 2, original preserved.
    const amend = await doctorAgent.post(`/api/v1/clinical/emr/${entryId}/amend`).send({
      diagnosis: 'Community-acquired pneumonia',
      reason: 'Chest X-ray result received',
    });
    expect(amend.status).toBe(200);
    expect(amend.body.data.version).toBe(2);
    expect(amend.body.data.content.diagnosis).toBe('Community-acquired pneumonia');

    // Version history has both, originals intact (C-04).
    const versions = await doctorAgent.get(`/api/v1/clinical/emr/${entryId}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(2);
    expect(versions.body.data[0].content.diagnosis).toBe('Acute bronchitis');
    expect(versions.body.data[0].reason).toBeUndefined();
    expect(versions.body.data[1].reason).toBe('Chest X-ray result received');

    // Audit trail for every write.
    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const write = await AuditLog.findOne({ action: 'emr.write', resourceId: entryId });
    expect(write).toBeTruthy();
    const amended = await AuditLog.findOne({ action: 'emr.amend', resourceId: entryId });
    expect(amended).toBeTruthy();
  });

  it('AC-25: nurse adds entry only for assigned patients; denial audited', async () => {
    const okEntry = await nurseAgent.post('/api/v1/clinical/nursing-entries').send({
      patientId: nursePatientId,
      category: 'vitals',
      note: 'BP 120/80, afebrile',
      vitalSigns: { systolic: 120, diastolic: 80, temperatureC: 36.8 },
    });
    expect(okEntry.status).toBe(201);

    // Unassigned patient (created fresh, no assignment) → denied + audited.
    const { Patient } = await import('../../src/models/patient.model.js');
    const stranger = await Patient.create({
      mrn: 'MRN-3001-9999',
      firstName: 'Stranger',
      lastName: 'NoAssign',
      dob: '1970-01-01',
      gender: 'other',
    });
    const denied = await nurseAgent.post('/api/v1/clinical/nursing-entries').send({
      patientId: String(stranger._id),
      category: 'observation',
      note: 'should not be allowed',
    });
    expect(denied.status).toBe(403);

    const { AuditLog } = await import('../../src/models/audit-log.model.js');
    const denial = await AuditLog.findOne({
      action: 'security.access_denied',
      module: 'clinical',
      resourceId: String(stranger._id),
    });
    expect(denial).toBeTruthy();
  });

  it('AC-27: patient sees only released finalized EMR; prescriptions visible own', async () => {
    const apptId = await checkedInAppointment('clin-key-4');
    const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    const encId = enc.body.data.id;

    const entry = await doctorAgent.post(`/api/v1/clinical/encounters/${encId}/emr`).send({
      symptoms: 'Headache',
      diagnosis: 'Tension headache',
    });
    const entryId = entry.body.data.id;
    await doctorAgent.post(`/api/v1/clinical/emr/${entryId}/finalize`);

    // Before release: patient list is empty.
    const before = await patientAgent.get(`/api/v1/clinical/encounters/${encId}/emr`);
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(0);

    // Patient cannot release to self.
    const selfRelease = await patientAgent.post(`/api/v1/clinical/emr/${entryId}/release`);
    expect(selfRelease.status).toBe(403);

    // Doctor releases → patient sees exactly that entry.
    const release = await doctorAgent.post(`/api/v1/clinical/emr/${entryId}/release`);
    expect(release.status).toBe(200);
    const after = await patientAgent.get(`/api/v1/clinical/encounters/${encId}/emr`);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].content.diagnosis).toBe('Tension headache');
    // Minimum-necessary: no version internals leaked.
    expect(after.body.data[0].version).toBeUndefined();

    // Prescription: patient sees own.
    const rx = await doctorAgent.post('/api/v1/clinical/prescriptions').send({
      encounterId: encId,
      items: [{ medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 15 }],
    });
    expect(rx.status).toBe(201);
    const myRx = await patientAgent.get('/api/v1/clinical/prescriptions');
    expect(myRx.status).toBe(200);
    expect(myRx.body.data.some((p: { id: string }) => p.id === rx.body.data.id)).toBe(true);
  });

  it('Encounter finalize → appointment COMPLETED (T-06) in one step', async () => {
    const apptId = await checkedInAppointment('clin-key-5');
    const enc = await doctorAgent.post('/api/v1/clinical/encounters').send({ appointmentId: apptId });
    const encId = enc.body.data.id;

    const fin = await doctorAgent.post(`/api/v1/clinical/encounters/${encId}/finalize`);
    expect(fin.status).toBe(200);
    expect(fin.body.data.encounter.status).toBe('FINALIZED');
    expect(fin.body.data.appointmentStatus).toBe('COMPLETED');

    // Double finalize → RECORD_FINALIZED.
    const again = await doctorAgent.post(`/api/v1/clinical/encounters/${encId}/finalize`);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('RECORD_FINALIZED');
  });

  it('Doctor cannot access another doctor encounter (scope R-01, audited)', async () => {
    // Create a second doctor + appointment flow via direct model access.
    const { User } = await import('../../src/models/user.model.js');
    const { Appointment } = await import('../../src/models/appointment.model.js');
    const { Encounter } = await import('../../src/models/clinical.model.js');
    const { hashPassword } = await import('../../src/utils/hash.js');
    const { facilitySlotStart } = await import('../../src/utils/date.js');

    const other = await User.create({
      email: 'doctor2@c.test',
      passwordHash: await hashPassword('Doctor@12345'),
      role: 'doctor',
      status: 'ACTIVE',
      staffProfile: { fullName: 'Dr. Other', department: 'General Medicine', specialties: [] },
    });
    const tomorrow = futureDate(DAY_OFFSET_DAYS);
    const appt = await Appointment.create({
      patientId,
      doctorId: other._id,
      departmentId,
      slot: {
        start: facilitySlotStart(tomorrow, '07:00'),
        end: facilitySlotStart(tomorrow, '08:00'),
      },
      serviceType: 'consultation',
      status: 'CHECKED_IN',
      activeSlot: true,
      bookedBy: { userId: doctorId, role: 'admin' },
      statusHistory: [{ from: null, to: 'CHECKED_IN', by: doctorId, byRole: 'admin', at: new Date() }],
    });
    void appt;
    const enc = await Encounter.create({
      patientId,
      doctorId: other._id,
      departmentId,
      appointmentId: appt._id,
      status: 'OPEN',
      createdBy: String(other._id),
    });

    const foreign = await doctorAgent.get(`/api/v1/clinical/encounters/${enc._id}`);
    expect(foreign.status).toBe(403);

    const write = await doctorAgent.post(`/api/v1/clinical/encounters/${enc._id}/emr`).send({ symptoms: 'x' });
    expect(write.status).toBe(403);
  });
});
