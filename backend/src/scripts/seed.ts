import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { RoleModel } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { permissionsForRole, ROLES } from '../config/constants.js';
import { hashPassword } from '../utils/hash.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Seed script (PH-01):
 *  - roles ← permission catalog (PERM-01..68; never invented strings)
 *  - admin bootstrap user from env (ADMIN_EMAIL / ADMIN_PASSWORD)
 *  - sample departments for the public directory + booking filters
 *
 * Idempotent: safe to re-run.
 */
async function seed(): Promise<void> {
  await connectDatabase();

  // 1. Roles from catalog
  for (const role of ROLES) {
    const permissions = permissionsForRole(role);
    await RoleModel.updateOne({ name: role }, { $set: { permissions } }, { upsert: true });
    logger.info({ role, count: permissions.length }, 'Seeded role permissions');
  }

  // 2. Bootstrap admin (env-driven; never hard-coded in code)
  const adminEmail = env.ADMIN_EMAIL.toLowerCase();
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      email: adminEmail,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'admin',
      status: 'ACTIVE',
      staffProfile: { fullName: 'System Administrator' },
    });
    logger.info({ email: adminEmail }, 'Bootstrap admin created');
  } else {
    logger.info({ email: adminEmail }, 'Bootstrap admin already exists — skipped');
  }

  // 3. Sample departments
  const departments = [
    { name: 'General Medicine', description: 'Primary care and general consultations', orderIndex: 1 },
    { name: 'Pediatrics', description: 'Child healthcare', orderIndex: 2 },
    { name: 'Cardiology', description: 'Heart and cardiovascular care', orderIndex: 3 },
    { name: 'Orthopedics', description: 'Bones, joints, and musculoskeletal care', orderIndex: 4 },
    { name: 'Laboratory', description: 'Diagnostic laboratory services', orderIndex: 5 },
    { name: 'Pharmacy', description: 'Medicine dispensing and advice', orderIndex: 6 },
  ];
  for (const dept of departments) {
    await Department.updateOne({ name: dept.name }, { $set: dept }, { upsert: true });
  }
  logger.info({ count: departments.length }, 'Seeded departments');

  await disconnectDatabase();
}

seed()
  .then(() => {
    logger.info('Seed completed');
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });
