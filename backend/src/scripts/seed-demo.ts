import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { RoleModel } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { DoctorSchedule } from '../models/doctor-schedule.model.js';
import { Patient } from '../models/patient.model.js';
import { Drug } from '../models/pharmacy.model.js';
import { LabTest } from '../models/lab.model.js';
import { permissionsForRole, ROLES } from '../config/constants.js';
import { hashPassword } from '../utils/hash.js';
import { logger } from '../config/logger.js';

/**
 * Demo seeder (dev only): one ACTIVE user per role + reference data so every
 * role dashboard is verifiable in the browser. Idempotent — safe to re-run.
 *
 *   admin@hms.local / Admin@12345          (bootstrap admin, from env)
 *   reception@hms.local / Recept@12345
 *   doctor@hms.local  / Doctor@12345
 *   nurse@hms.local   / Nurse@12345
 *   labtech@hms.local / Tech@12345
 *   pharmacy@hms.local / Pharm@12345
 *   billing@hms.local / Acct@12345
 *   patient@hms.local / Patient@12345
 */

const DEMO_USERS = [
  { email: 'reception@hms.local', password: 'Recept@12345', role: 'receptionist' as const, fullName: 'Front Desk' },
  { email: 'doctor@hms.local', password: 'Doctor@12345', role: 'doctor' as const, fullName: 'Dr. Ada Sharma' },
  { email: 'nurse@hms.local', password: 'Nurse@12345', role: 'nurse' as const, fullName: 'Nurse Joy Mali' },
  { email: 'labtech@hms.local', password: 'Tech@12345', role: 'lab_tech' as const, fullName: 'Lab Tech Sam' },
  { email: 'pharmacy@hms.local', password: 'Pharm@12345', role: 'pharmacist' as const, fullName: 'Pharmacist Kim' },
  { email: 'billing@hms.local', password: 'Acct@12345', role: 'accountant' as const, fullName: 'Billing Ana' },
];

const STAFF_DEPARTMENT = 'General Medicine';

async function seedDemo(): Promise<void> {
  await connectDatabase();

  // Roles (same as base seed — keeps this script standalone).
  for (const role of ROLES) {
    await RoleModel.updateOne(
      { name: role },
      { $set: { permissions: permissionsForRole(role) } },
      { upsert: true }
    );
  }

  // Demo staff users (idempotent; backfills the staff department for the
  // public directory + booking department resolution).
  for (const u of DEMO_USERS) {
    const existing = await User.findOne({ email: u.email });
    if (!existing) {
      await User.create({
        email: u.email,
        passwordHash: await hashPassword(u.password),
        role: u.role,
        status: 'ACTIVE',
        staffProfile: { fullName: u.fullName, department: STAFF_DEPARTMENT },
      });
      logger.info({ email: u.email, role: u.role }, 'Demo user created');
    } else if (!existing.staffProfile?.department) {
      existing.staffProfile = { ...existing.staffProfile, fullName: existing.staffProfile?.fullName ?? u.fullName, department: STAFF_DEPARTMENT };
      await existing.save();
    }
  }

  // Patient user + linked patient record (care team: doctor + nurse so both
  // role dashboards have a real assigned patient).
  const patientEmail = 'patient@hms.local';
  let patientUser = await User.findOne({ email: patientEmail });
  if (!patientUser) {
    patientUser = await User.create({
      email: patientEmail,
      passwordHash: await hashPassword('Patient@12345'),
      role: 'patient',
      status: 'ACTIVE',
    });
  }
  const doctor = await User.findOne({ email: 'doctor@hms.local' });
  const nurse = await User.findOne({ email: 'nurse@hms.local' });
  const careTeam = [doctor, nurse].filter(Boolean).map((u) => u!._id);
  const existingPatient = await Patient.findOne({ userId: patientUser._id });
  if (!existingPatient) {
    await Patient.create({
      userId: patientUser._id,
      mrn: 'MRN-DEMO-0001',
      firstName: 'Demo',
      lastName: 'Patient',
      dob: '1990-06-15',
      gender: 'female',
      contacts: { phone: '+1-555-0100' },
      assignedDoctorIds: careTeam,
    });
  } else {
    let dirty = false;
    for (const id of careTeam) {
      if (!existingPatient.assignedDoctorIds.some((d) => String(d) === String(id))) {
        existingPatient.assignedDoctorIds.push(id);
        dirty = true;
      }
    }
    if (dirty) await existingPatient.save();
  }

  // Department + weekday schedule for the demo doctor (booking + encounters).
  const dept = await Department.findOneAndUpdate(
    { name: STAFF_DEPARTMENT },
    { $set: { name: STAFF_DEPARTMENT, publicVisible: true, orderIndex: 1 } },
    { upsert: true, new: true }
  );
  if (doctor) {
    const today = new Date();
    today.setUTCDate(today.getUTCDate() + 1);
    const weekday = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`).getUTCDay();
    const scheduleExists = await DoctorSchedule.findOne({
      doctorId: doctor._id,
      departmentId: dept!._id,
      weekday,
    });
    if (!scheduleExists) {
      await DoctorSchedule.create({
        doctorId: doctor._id,
        departmentId: dept!._id,
        weekday,
        startTime: '08:00',
        endTime: '17:00',
        slotLengthMinutes: 30,
      });
    }
  }

  // Pharmacy + lab catalogs (dashboards render real data).
  await Drug.updateOne(
    { code: 'PARA500' },
    { $set: { code: 'PARA500', name: 'Paracetamol 500mg', form: 'tablet', strength: '500mg', unitPriceMinor: 500, reorderLevel: 20, active: true } },
    { upsert: true }
  );
  await Drug.updateOne(
    { code: 'AMOX500' },
    { $set: { code: 'AMOX500', name: 'Amoxicillin 500mg', form: 'capsule', strength: '500mg', unitPriceMinor: 1200, reorderLevel: 20, active: true } },
    { upsert: true }
  );
  await LabTest.updateOne(
    { code: 'CBC' },
    { $set: { code: 'CBC', name: 'Complete Blood Count', priceMinor: 25000, active: true, criticalRules: [{ name: 'hemoglobin', min: 4, max: 20, unit: 'g/dL' }] } },
    { upsert: true }
  );
  await LabTest.updateOne(
    { code: 'GLU' },
    { $set: { code: 'GLU', name: 'Fasting Glucose', priceMinor: 12000, active: true, criticalRules: [{ name: 'glucose', min: 40, max: 450, unit: 'mg/dL' }] } },
    { upsert: true }
  );

  logger.info('Demo seed completed (idempotent)');
  await disconnectDatabase();
}

seedDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Demo seed failed');
    process.exit(1);
  });
