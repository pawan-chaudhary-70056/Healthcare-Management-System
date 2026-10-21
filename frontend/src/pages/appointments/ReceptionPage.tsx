import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';
import { newIdempotencyKey, departmentIdByName } from '../../utils/booking.js';

/**
 * Reception flows (PH-03): book for any patient (EP-21 any), check in with
 * queue token (EP-25/26), confirm / no-show / cancel (T-03/09/11), waitlist
 * view (EP-27). All actions are server-permission-gated; UI only hides.
 */

interface AppointmentItem {
  id: string;
  patientId: string;
  doctorId?: { _id?: string; staffProfile?: { fullName?: string } } | string;
  departmentId?: { _id?: string; name?: string } | string;
  slot: { start: string; end: string };
  status: string;
  appointmentNo?: string;
}

interface PatientItem {
  _id: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

interface DepartmentItem {
  _id?: string;
  id?: string;
  name: string;
}

interface Slot {
  start: string;
  end: string;
}

interface DoctorItem {
  id: string;
  fullName: string;
  department?: string;
}

interface QueueItem {
  id: string;
  tokenNo: number;
  status: string;
  appointmentId: string;
  patient: { firstName?: string; lastName?: string; mrn?: string } | null;
}

const dt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ReceptionPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);

  const patients = useQuery({
    queryKey: ['patients', q],
    queryFn: async () => {
      const res = await api.get<{ data: PatientItem[] }>(`${EP.PATIENTS}?q=${encodeURIComponent(q)}`);
      return res.data.data;
    },
    enabled: user?.role === 'receptionist' || user?.role === 'admin',
  });

  const today = useQuery({
    queryKey: ['appointments', 'today'],
    queryFn: async () => {
      const res = await api.get<{ data: AppointmentItem[]; meta: { total: number } }>(
        `${EP.APPOINTMENTS}?limit=50`
      );
      return res.data;
    },
  });

  const doctors = useQuery({
    queryKey: ['public', 'doctors'],
    queryFn: async () => {
      const res = await api.get<{ data: DoctorItem[] }>(EP.PUBLIC_DOCTORS);
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

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: async () => {
      const res = await api.get<{ data: QueueItem[] }>(EP.APPOINTMENT_QUEUE);
      return res.data.data;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const departments = useQuery({
    queryKey: ['public', 'departments'],
    queryFn: async () => {
      const res = await api.get<{ data: DepartmentItem[] }>(EP.PUBLIC_DEPARTMENTS);
      return res.data.data;
    },
  });

  const book = useMutation({
    mutationFn: async () => {
      if (!slot) throw new Error('Select a slot');
      if (!patientId) throw new Error('Select a patient');
      // EP-21 requires departmentId (422) and the Idempotency-Key header (428).
      const deptId = departmentIdByName(departments.data, doctors.data?.find((d) => d.id === doctorId)?.department);
      if (!deptId) throw new Error('Could not resolve the department for this doctor');
      const res = await api.post(
        EP.APPOINTMENTS,
        {
          patientId,
          doctorId,
          departmentId: deptId,
          slotStartIso: slot.start,
          slotEndIso: slot.end,
        },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } }
      );
      return res.data;
    },
    onSuccess: () => {
      setSlot(null);
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'checkin' | 'confirm' | 'no-show' | 'start' | 'complete' }) => {
      const url =
        kind === 'checkin'
          ? EP.APPOINTMENT_CHECKIN(id)
          : kind === 'confirm'
            ? EP.APPOINTMENT_CONFIRM(id)
            : kind === 'no-show'
              ? EP.APPOINTMENT_NO_SHOW(id)
              : kind === 'start'
                ? EP.APPOINTMENT_START(id)
                : EP.APPOINTMENT_COMPLETE(id);
      const res = await api.post(url, {});
      return res.data;
    },
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => api.post(EP.APPOINTMENT_CANCEL(id), { reason: 'Cancelled by front desk' }),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [error]);

  const canManage = user?.permissions.includes('appointment.create.any') ?? false;

  return (
    <div>
      <h1 className="text-xl font-bold">Reception</h1>
      <p className="mt-1 text-sm text-slate-600">Bookings, check-in, and the visit queue.</p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Book for a patient</h2>
          <div className="mt-3">
            <input
              placeholder="Search patients by name or MRN…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            {q.length >= 2 && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {(patients.data ?? []).map((p) => (
                  <button
                    key={p._id}
                    onClick={() => setPatientId(p._id)}
                    className={`block w-full rounded-md border px-3 py-1.5 text-left text-sm ${
                      patientId === p._id ? 'border-primary-600 bg-primary-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    {p.firstName} {p.lastName} · {p.mrn}
                  </button>
                ))}
                {(patients.data ?? []).length === 0 && (
                  <p className="text-xs text-slate-500">No matches.</p>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="r-doctor" className="block text-xs font-medium text-slate-600">Doctor</label>
              <select
                id="r-doctor"
                value={doctorId}
                onChange={(e) => { setDoctorId(e.target.value); setSlot(null); }}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="">Select…</option>
                {(doctors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="r-date" className="block text-xs font-medium text-slate-600">Date</label>
              <input
                id="r-date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setSlot(null); }}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          {doctorId && date && (slots.data ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
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
                  {new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => book.mutate()}
            disabled={!canManage || book.isPending || !slot || !patientId}
            className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {book.isPending ? 'Booking…' : 'Book appointment'}
          </button>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Today's queue</h2>
          {(queue.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No check-ins yet today.</p>
          ) : (
            <ol className="mt-2 space-y-1">
              {(queue.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                  <span>
                    <span className="mr-2 font-mono text-primary-700">#{t.tokenNo}</span>
                    {t.patient ? `${t.patient.firstName ?? ''} ${t.patient.lastName ?? ''}` : 'Patient'}{' '}
                    <span className="text-xs text-slate-500">{t.status}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="mt-6">
        <h2 className="font-semibold text-slate-700">All appointments</h2>
        {today.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : (today.data?.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None scheduled.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(today.data?.data ?? []).map((a) => {
              const doctorName =
                typeof a.doctorId === 'object' ? a.doctorId?.staffProfile?.fullName : undefined;
              const deptName = typeof a.departmentId === 'object' ? a.departmentId?.name : undefined;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{dt(a.slot.start)} · {a.status}</p>
                    <p className="text-xs text-slate-500">
                      {doctorName ?? 'Doctor'}{deptName ? ` · ${deptName}` : ''}
                      {a.appointmentNo ? ` · ${a.appointmentNo}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.status === 'REQUESTED' && (
                      <button onClick={() => action.mutate({ id: a.id, kind: 'confirm' })} className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">Confirm</button>
                    )}
                    {a.status === 'CONFIRMED' && (
                      <>
                        <button onClick={() => action.mutate({ id: a.id, kind: 'checkin' })} className="rounded-md border px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50">Check in</button>
                        <button onClick={() => action.mutate({ id: a.id, kind: 'no-show' })} className="rounded-md border px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50">No-show</button>
                      </>
                    )}
                    {a.status === 'CHECKED_IN' && (
                      <button onClick={() => action.mutate({ id: a.id, kind: 'start' })} className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">Start</button>
                    )}
                    {a.status === 'IN_CONSULTATION' && (
                      <button onClick={() => action.mutate({ id: a.id, kind: 'complete' })} className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">Complete</button>
                    )}
                    {['REQUESTED', 'SCHEDULED', 'CONFIRMED'].includes(a.status) && (
                      <button onClick={() => cancel.mutate(a.id)} className="rounded-md border px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Cancel</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
