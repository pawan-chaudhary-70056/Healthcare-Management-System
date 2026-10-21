import type { RequestHandler, Request } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { actorOf } from '../helpers/actor.helper.js';
import { ok, created, pageMeta } from '../helpers/response.helper.js';
import { parsePagination } from '../helpers/pagination.helper.js';
import { AppError } from '../errors/app-error.js';
import { facilityDateString } from '../utils/date.js';
import { APPOINTMENT_STATUS } from '../config/constants.js';
import { QueueToken } from '../models/appointment.model.js';
import * as service from '../services/appointment.service.js';
import * as slots from '../services/slots.service.js';
import * as waitlist from '../services/waitlist.service.js';

/** Appointment controller — EP-20…27 (thin HTTP layer). */

/** Enforce the mandatory Idempotency-Key on booking (428 per contract rules). */
function requireIdempotencyKey(req: { headers: Record<string, unknown> }): string {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? String(raw[0]) : typeof raw === 'string' ? raw : undefined;
  if (!key || key.length < 8 || key.length > 200) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required for booking.');
  }
  return key;
}

// EP-20 GET /appointments/slots?doctorId&date
export const listSlots: RequestHandler = asyncHandler(async (req, res) => {
  const doctorId = req.query.doctorId as string | undefined;
  const date = req.query.date as string | undefined;
  if (!doctorId || !date) {
    throw new AppError('VALIDATION_ERROR', 'doctorId and date are required.', [
      { field: 'doctorId', issue: 'required' },
      { field: 'date', issue: 'required' },
    ]);
  }
  ok(res, await slots.listSlotsForDoctorDate(doctorId, date));
});

// EP-21 POST /appointments
export const book: RequestHandler = asyncHandler(async (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req);
  const { appointment, replayed } = await service.bookAppointment(
    { ...req.body, idempotencyKey },
    actorOf(req)
  );
  if (replayed) {
    ok(res, service.serializeAppointment(appointment));
    return;
  }
  created(res, service.serializeAppointment(appointment));
});

// EP-22 GET /appointments/mine · GET /appointments (staff)
export const listMine: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await service.listAppointments({}, skip, limit, actorOf(req));
  ok(res, items.map(service.serializeAppointment), 200, pageMeta(page, limit, total));
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await service.listAppointments(
    {
      doctorId: req.query.doctorId as string | undefined,
      patientId: req.query.patientId as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
      status: req.query.status as (typeof APPOINTMENT_STATUS)[number] | undefined,
      date: req.query.date as string | undefined,
    },
    skip,
    limit,
    actorOf(req)
  );
  ok(res, items.map(service.serializeAppointment), 200, pageMeta(page, limit, total));
});

// EP-23/24 reschedule + cancel
export const reschedule: RequestHandler = asyncHandler(async (req, res) => {
  const moved = await service.rescheduleAppointment(req.params.id as string, req.body, actorOf(req));
  ok(res, service.serializeAppointment(moved));
});

export const cancel: RequestHandler = asyncHandler(async (req, res) => {
  const cancelled = await service.cancelAppointment(req.params.id as string, req.body, actorOf(req));
  const date = cancelled.slot.start.toISOString().slice(0, 10);
  void waitlist.offerFreedSlot(String(cancelled.doctorId), date).catch(() => {});
  ok(res, service.serializeAppointment(cancelled));
});

// EP-25 check-in
export const checkIn: RequestHandler = asyncHandler(async (req, res) => {
  const result = await service.checkIn(req.params.id as string, actorOf(req));
  ok(res, { appointment: service.serializeAppointment(result.appointment), queueToken: result.token });
});

// EP-26 queue board
export const queue: RequestHandler = asyncHandler(async (req: Request, res) => {
  const date = (req.query.date as string | undefined) ?? facilityDateString(new Date());
  const query: Record<string, unknown> = { date };
  if (req.query.departmentId) query.departmentId = req.query.departmentId;
  if (req.user?.role === 'doctor') query.doctorId = req.user.id;
  const items = await QueueToken.find(query)
    .sort({ tokenNo: 1 })
    .populate('patientId', 'firstName lastName mrn')
    .lean();
  ok(
    res,
    items.map((t) => ({
      id: String(t._id),
      tokenNo: t.tokenNo,
      status: t.status,
      appointmentId: String(t.appointmentId),
      patient: t.patientId,
      issuedAt: t.issuedAt,
    }))
  );
});

// Lifecycle transitions exposed per contract rule 4
export const confirm: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, service.serializeAppointment(await service.confirmAppointment(req.params.id as string, actorOf(req))));
});

export const start: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, service.serializeAppointment(await service.startConsultation(req.params.id as string, actorOf(req))));
});

export const complete: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, service.serializeAppointment(await service.completeConsultation(req.params.id as string, actorOf(req))));
});

export const noShow: RequestHandler = asyncHandler(async (req, res) => {
  ok(res, service.serializeAppointment(await service.markNoShow(req.params.id as string, actorOf(req))));
});

// EP-27 waitlist
export const joinWaitlist: RequestHandler = asyncHandler(async (req, res) => {
  const entry = await waitlist.join(req.body, actorOf(req));
  created(res, { id: String(entry._id), status: entry.status, date: entry.date, doctorId: String(entry.doctorId) });
});

export const leaveWaitlist: RequestHandler = asyncHandler(async (req, res) => {
  await waitlist.leave(req.params.id as string, actorOf(req));
  ok(res, { left: true });
});

export const listWaitlist: RequestHandler = asyncHandler(async (req, res) => {
  ok(
    res,
    await waitlist.listWaitlist(
      { doctorId: req.query.doctorId as string | undefined, date: req.query.date as string | undefined },
      actorOf(req)
    )
  );
});
