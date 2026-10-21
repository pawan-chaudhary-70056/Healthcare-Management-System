import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  bookSchema,
  rescheduleSchema,
  cancelSchema,
  waitlistJoinSchema,
} from '../validators/appointment.validator.js';
import * as controller from '../controllers/appointment.controller.js';

/**
 * Appointments routes — API Standards §3.4 (EP-20…27).
 * Booking requires Idempotency-Key (428 when missing — API Standards §4.3).
 */
export const appointmentRouter = Router();

appointmentRouter.use(requireAuth);

// EP-20 slots
appointmentRouter.get(
  '/slots',
  requirePermission(['appointment.create.any', 'appointment.create.own', 'appointment.read.own-schedule']),
  controller.listSlots
);

// EP-21 booking
appointmentRouter.post(
  '/',
  requirePermission(['appointment.create.any', 'appointment.create.own']),
  validate(bookSchema),
  controller.book
);

// EP-22 lists
appointmentRouter.get('/mine', requirePermission(['appointment.create.own', 'appointment.read.own-schedule']), controller.listMine);
appointmentRouter.get(
  '/',
  requirePermission(['appointment.create.any', 'appointment.read.own-schedule', 'appointment.read.assigned']),
  controller.list
);

// EP-23/24 reschedule + cancel
appointmentRouter.post('/:id/reschedule', requirePermission('appointment.reschedule'), validate(rescheduleSchema), controller.reschedule);
appointmentRouter.post('/:id/cancel', requirePermission('appointment.cancel'), validate(cancelSchema), controller.cancel);

// EP-25 check-in
appointmentRouter.post('/:id/checkin', requirePermission('appointment.checkin'), controller.checkIn);

// EP-26 queue board
appointmentRouter.get('/queue', requirePermission(['appointment.queue.manage', 'appointment.read.own-schedule']), controller.queue);

// Lifecycle transitions (contract rule 4 — no generic status PATCH)
appointmentRouter.post('/:id/confirm', requirePermission('appointment.create.any'), controller.confirm);
appointmentRouter.post('/:id/start', requirePermission('encounter.create'), controller.start);
appointmentRouter.post('/:id/complete', requirePermission('encounter.create'), controller.complete);
appointmentRouter.post('/:id/no-show', requirePermission(['appointment.create.any', 'appointment.read.own-schedule']), controller.noShow);

// EP-27 waitlist
appointmentRouter.post('/waitlist', requirePermission(['appointment.create.any', 'appointment.create.own']), validate(waitlistJoinSchema), controller.joinWaitlist);
appointmentRouter.delete('/waitlist/:id', requirePermission(['appointment.create.any', 'appointment.create.own']), controller.leaveWaitlist);
appointmentRouter.get('/waitlist', requirePermission('appointment.create.any'), controller.listWaitlist);

// NOTE: '/queue' and '/waitlist' are registered before '/:id' routes;
// Express matches in registration order so static paths win.
