import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  exceptionCreateSchema,
  doctorUserCreateSchema,
  userCreateSchema,
  userUpdateSchema,
  roleAssignSchema,
} from '../validators/admin.validator.js';
import * as controller from '../controllers/admin.controller.js';

/**
 * Admin & reference-data routes — every route declares its permission.
 * Public directory subset (EP-08/09) is open.
 */
export const adminRouter = Router();

// ---- Public directory (EP-08/09, FR-56) — no auth -------------------------
const publicRouter = Router();
publicRouter.get('/departments', controller.publicDepartments);
publicRouter.get('/doctors', controller.publicDoctors);
export { publicRouter };

// ---- Admin CRUD (EP-71a/71b) — settings.manage ----------------------------
adminRouter.use(requireAuth);

adminRouter.get('/departments', requirePermission('settings.manage'), controller.listDepartments);
adminRouter.post('/departments', requirePermission('settings.manage'), validate(departmentCreateSchema), controller.createDepartment);
adminRouter.patch('/departments/:id', requirePermission('settings.manage'), validate(departmentUpdateSchema), controller.updateDepartment);

adminRouter.get('/doctors', requirePermission('settings.manage'), controller.listDoctors);
adminRouter.post('/doctors', requirePermission('settings.manage'), validate(doctorUserCreateSchema), controller.createDoctor);

adminRouter.get('/schedules', requirePermission('settings.manage'), controller.listSchedules);
adminRouter.post('/schedules', requirePermission('settings.manage'), validate(scheduleCreateSchema), controller.createSchedule);
adminRouter.patch('/schedules/:id', requirePermission('settings.manage'), validate(scheduleUpdateSchema), controller.updateSchedule);

adminRouter.get('/schedule-exceptions', requirePermission('settings.manage'), controller.listScheduleExceptions);
adminRouter.post('/schedule-exceptions', requirePermission('settings.manage'), validate(exceptionCreateSchema), controller.createScheduleException);
adminRouter.delete('/schedule-exceptions/:id', requirePermission('settings.manage'), controller.deleteScheduleException);

// ---- User & role management (EP-70/71, PERM-60/61) ------------------------
adminRouter.get('/users', requirePermission('user.manage'), controller.listUsers);
adminRouter.post('/users', requirePermission('user.manage'), validate(userCreateSchema), controller.createUser);
adminRouter.patch('/users/:id', requirePermission('user.manage'), validate(userUpdateSchema), controller.updateUser);
adminRouter.put('/users/:id/role', requirePermission('role.assign'), validate(roleAssignSchema), controller.assignRole);

// ---- Backups (EP-74, PERM-68) ---------------------------------------------
adminRouter.post('/backups', requirePermission('backup.manage'), controller.triggerBackup);
