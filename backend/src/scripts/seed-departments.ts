import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { RoleModel } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { DoctorSchedule } from '../models/doctor-schedule.model.js';
import { permissionsForRole, ROLES, type Role } from '../config/constants.js';
import { hashPassword } from '../utils/hash.js';
import { logger } from '../config/logger.js';

/**
 * Department accounts seeder — one login (ID + password) per department.
 * Idempotent: safe to re-run; existing accounts are only backfilled.
 *
 *   Department          Account (email)          Password       Role
 *   ------------------  -----------------------  -------------  ------------
 *   General Medicine    general@hms.local        Dept@12345     doctor
 *   Pediatrics          peds@hms.local           Dept@12345     doctor
 *   Cardiology          cardio@hms.local         Dept@12345     doctor
 *   Orthopedics         ortho@hms.local          Dept@12345     doctor
 *   Laboratory          lab@hms.local            Dept@12345     lab_tech
 *   Pharmacy            pharmacy@hms.local       Dept@12345     pharmacist
 *   Front Desk          frontdesk@hms.local      Dept@12345     receptionist
 *   Nursing             nursing@hms.local        Dept@12345     nurse
 *   Finance (Billing)   finance@hms.local        Dept@12345     accountant
 *
 * Clinical departments are also ensured as Department documents (public
 * directory + booking). Doctor accounts get an active schedule template for
 * the upcoming week so booking works immediately.
 */

const DEPT_PASSWORD = 'Dept@12345';

interface DepartmentAccount {
  /** Department document name (public directory) — omitted for non-clinical desks. */
  department?: string;
  description?: string;
  orderIndex?: number;
  email: string;
  role: Role;
  fullName: string;
  /** Create an active weekday schedule template (doctors only). */
  withSchedule?: boolean;
}

const DEPARTMENT_ACCOUNTS: DepartmentAccount[] = [
  {
    department: 'General Medicine',
    description: 'Primary care and general consultations',
    orderIndex: 1,
    email: 'general@hms.local',
    role: 'doctor',
    fullName: 'Dr. General Medicine',
    withSchedule: true,
  },
  {
    department: 'Pediatrics',
    description: 'Child healthcare',
    orderIndex: 2,
    email: 'peds@hms.local',
    role: 'doctor',
    fullName: 'Dr. Pediatrics',
    withSchedule: true,
  },
  {
    department: 'Cardiology',
    description: 'Heart and cardiovascular care',
    orderIndex: 3,
    email: 'cardio@hms.local',
    role: 'doctor',
    fullName: 'Dr. Cardiology',
    withSchedule: true,
  },
  {
    department: 'Orthopedics',
    description: 'Bones, joints, and musculoskeletal care',
    orderIndex: 4,
    email: 'ortho@hms.local',
    role: 'doctor',
    fullName: 'Dr. Orthopedics',
    withSchedule: true,
  },
  {
    department: 'Laboratory',
    description: 'Diagnostic laboratory services',
    orderIndex: 5,
    email: 'lab@hms.local',
    role: 'lab_tech',
    fullName: 'Laboratory Desk',
  },
  {
    department: 'Pharmacy',
    description: 'Medicine dispensing and advice',
    orderIndex: 6,
    email: 'pharmacy@hms.local',
    role: 'pharmacist',
    fullName: 'Pharmacy Desk',
  },
  { email: 'frontdesk@hms.local', role: 'receptionist', fullName: 'Front Desk' },
  { email: 'nursing@hms.local', role: 'nurse', fullName: 'Nursing Station' },
  { email: 'finance@hms.local', role: 'accountant', fullName: 'Finance Desk' },
];

async function ensureRolePermissions(): Promise<void> {
  for (const role of ROLES) {
    await RoleModel.updateOne(
      { name: role },
      { $set: { permissions: permissionsForRole(role) } },
      { upsert: true }
    );
  }
}

async function seedDepartmentAccounts(): Promise<void> {
  await connectDatabase();
  await ensureRolePermissions();

  for (const acc of DEPARTMENT_ACCOUNTS) {
    // Ensure the clinical Department document (public directory + booking).
    let departmentId: string | undefined;
    if (acc.department) {
      const dept = await Department.findOneAndUpdate(
        { name: acc.department },
        {
          $set: {
            name: acc.department,
            description: acc.description,
            publicVisible: true,
            active: true,
            orderIndex: acc.orderIndex ?? 0,
          },
        },
        { upsert: true, new: true }
      );
      departmentId = String(dept!._id);
    }

    // Ensure the department account (idempotent; backfill department link).
    const existing = await User.findOne({ email: acc.email });
    if (!existing) {
      await User.create({
        email: acc.email,
        passwordHash: await hashPassword(DEPT_PASSWORD),
        role: acc.role,
        status: 'ACTIVE',
        staffProfile: { fullName: acc.fullName, department: acc.department },
      });
      logger.info({ email: acc.email, role: acc.role, department: acc.department }, 'Department account created');
    } else if (acc.department && existing.staffProfile?.department !== acc.department) {
      existing.staffProfile = {
        ...existing.staffProfile,
        fullName: existing.staffProfile?.fullName ?? acc.fullName,
        department: acc.department,
      };
      await existing.save();
      logger.info({ email: acc.email }, 'Department account backfilled');
    }

    // Doctor accounts: schedule template for the next 7 weekdays (booking-ready).
    if (acc.withSchedule && departmentId) {
      const doctor = await User.findOne({ email: acc.email });
      if (doctor) {
        for (let offset = 1; offset <= 7; offset += 1) {
          const day = new Date();
          day.setUTCDate(day.getUTCDate() + offset);
          const weekday = new Date(`${day.toISOString().slice(0, 10)}T00:00:00Z`).getUTCDay();
          await DoctorSchedule.updateOne(
            { doctorId: doctor._id, departmentId, weekday },
            {
              $set: {
                doctorId: doctor._id,
                departmentId,
                weekday,
                startTime: '08:00',
                endTime: '17:00',
                slotLengthMinutes: 30,
                active: true,
              },
            },
            { upsert: true }
          );
        }
      }
    }
  }

  logger.info('Department accounts seed completed (idempotent)');
  await disconnectDatabase();
}

seedDepartmentAccounts()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Department accounts seed failed');
    process.exit(1);
  });
