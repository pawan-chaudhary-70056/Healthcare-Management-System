import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';
import { newIdempotencyKey, departmentIdByName } from '../../utils/booking.js';

/**
 * Patient portal — own appointments (FR-14 self-booking entry, EP-22 mine).
 * Patients see only their own appointments (server-scoped, AC-21).
 */

interface AppointmentItem {
  id: string;
  doctorId?: { _id?: string; staffProfile?: { fullName?: string } } | string;
  departmentId?: { _id?: string; name?: string } | string;
  slot: { start: string; end: string };
  status: string;
  appointmentNo?: string;
}

interface Slot {
  start: string;
  end: string;
}

interface DepartmentItem {
  _id?: string;
  id?: string;
  name: string;
}

interface DoctorDirectoryItem {
  id: string;
  fullName: string;
  department?: string;
  availableWeekdays: number[];
}

const dt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function PatientAppointmentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Booking form state
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');

  const mine = useQuery({
    queryKey: ['appointments', 'mine'],
    queryFn: async () => {
      const res = await api.get<{ data: AppointmentItem[] }>(EP.APPOINTMENTS_MINE);
      return res.data.data;
    },
  });

  const doctors = useQuery({
    queryKey: ['public', 'doctors'],
    queryFn: async () => {
      const res = await api.get<{ data: DoctorDirectoryItem[] }>(EP.PUBLIC_DOCTORS);
      return res.data.data;
    },
  });

  const departments = useQuery({
    queryKey: ['public', 'departments'],
    queryFn: async () => {
      const res = await api.get<{ data: DepartmentItem[] }>(EP.PUBLIC_DEPARTMENTS);
      return res.data.data;
    },
  });

  const slots = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: async () => {
      const res = await api.get<{ data: Slot[] }>(
        `${EP.APPOINTMENT_SLOTS}?doctorId=${doctorId}&date=${date}`
      );
      return res.data.data;
    },
    enabled: doctorId !== '' && date !== '',
  });

  const book = useMutation({
    mutationFn: async () => {
      if (!slot) throw new Error('Select a slot first');
      // EP-21 requires departmentId (422) and the Idempotency-Key header (428).
      const deptId = departmentIdByName(departments.data, doctors.data?.find((d) => d.id === doctorId)?.department);
      if (!deptId) throw new Error('Could not resolve the department for this doctor');
      const res = await api.post<{ data: AppointmentItem }>(
        EP.APPOINTMENTS,
        {
          doctorId,
          departmentId: deptId,
          slotStartIso: slot.start,
          slotEndIso: slot.end,
          reasonForVisit: reason || undefined,
        },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } }
      );
      return res.data.data;
    },
    onSuccess: (created) => {
      setNotice(`Booked — reference ${created.appointmentNo ?? created.id}`);
      setSlot(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (err) => setError(extractError(err).message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      api.post(EP.APPOINTMENT_CANCEL(id), { reason: 'Cancelled by patient' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (err) => setError(extractError(err).message),
  });

  useEffect(() => {
    if (error || notice) {
      const t = setTimeout(() => {
        setError(null);
        setNotice(null);
      }, 5000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [error, notice]);

  const isPatient = user?.role === 'patient';

  return (
    <div>
      <h1 className="text-xl font-bold">My appointments</h1>
      <p className="mt-1 text-sm text-slate-600">
        Book, view, and cancel your visits. Reminders include date, time, and department only.
      </p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {isPatient && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Book a new appointment</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="doctor" className="block text-xs font-medium text-slate-600">
                Doctor
              </label>
              <select
                id="doctor"
                value={doctorId}
                onChange={(e) => {
                  setDoctorId(e.target.value);
                  setSlot(null);
                }}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="">Select…</option>
                {(doctors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                    {d.department ? ` — ${d.department}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="date" className="block text-xs font-medium text-slate-600">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlot(null);
                }}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {doctorId && date && (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-600">Available slots</p>
              {slots.isLoading ? (
                <p className="mt-1 text-sm text-slate-500">Loading…</p>
              ) : (slots.data ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  No slots on this date. If the day is fully booked, the front desk can add you to
                  the waitlist.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(slots.data ?? []).map((s) => (
                    <button
                      key={s.start}
                      onClick={() => setSlot(s)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        slot?.start === s.start
                          ? 'border-primary-600 bg-primary-50 font-medium text-primary-700'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {new Date(s.start).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {slot && (
            <div className="mt-3">
              <label htmlFor="reason" className="block text-xs font-medium text-slate-600">
                Reason for visit (private — never included in notifications)
              </label>
              <input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => book.mutate()}
                disabled={book.isPending}
                className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {book.isPending ? 'Booking…' : 'Confirm booking'}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-slate-700">Upcoming & past</h2>
        {mine.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : (mine.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No appointments yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(mine.data ?? []).map((a) => {
              const doctorName =
                typeof a.doctorId === 'object' && a.doctorId?.staffProfile?.fullName
                  ? a.doctorId.staffProfile.fullName
                  : '';
              const deptName = typeof a.departmentId === 'object' ? a.departmentId?.name : '';
              const cancellable = ['REQUESTED', 'SCHEDULED', 'CONFIRMED'].includes(a.status);
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{dt(a.slot.start)}</p>
                    <p className="text-xs text-slate-500">
                      {doctorName || 'Doctor'}
                      {deptName ? ` · ${deptName}` : ''} ·{' '}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{a.status}</span>
                    </p>
                  </div>
                  {cancellable && (
                    <button
                      onClick={() => cancel.mutate(a.id)}
                      disabled={cancel.isPending}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Need help? See <Link to="/appointments/info" className="underline">appointment info</Link> or
        contact the front desk. {departments.data ? '' : ''}
      </p>
    </div>
  );
}
