import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Doctor schedule view (FR-20 / AC-21) — the server scopes results to the
 * signed-in doctor's own appointments; the page only renders them.
 */

interface AppointmentItem {
  id: string;
  slot: { start: string; end: string };
  status: string;
  appointmentNo?: string;
  departmentId?: { name?: string } | string;
}

const dt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function DoctorSchedulePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const schedule = useQuery({
    queryKey: ['appointments', 'doctor'],
    queryFn: async () => {
      const res = await api.get<{ data: AppointmentItem[]; meta: { total: number } }>(
        `${EP.APPOINTMENTS}?limit=100`
      );
      return res.data;
    },
  });

  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'start' | 'complete' }) =>
      api.post(kind === 'start' ? EP.APPOINTMENT_START(id) : EP.APPOINTMENT_COMPLETE(id), {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (err) => {
      const payload = extractError(err);
      window.alert(`${payload.code}: ${payload.message}`);
    },
  });

  const isDoctor = user?.role === 'doctor';

  return (
    <div>
      <h1 className="text-xl font-bold">My schedule</h1>
      <p className="mt-1 text-sm text-slate-600">
        Your appointments only — other doctors' schedules are not visible (AC-21).
      </p>

      {schedule.isLoading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : (schedule.data?.data ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No appointments on your schedule.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {(schedule.data?.data ?? []).map((a) => {
            const deptName = typeof a.departmentId === 'object' ? a.departmentId?.name : undefined;
            return (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{dt(a.slot.start)}</p>
                  <p className="text-xs text-slate-500">
                    {deptName ? `${deptName} · ` : ''}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{a.status}</span>
                  </p>
                </div>
                {isDoctor && (
                  <div className="flex gap-1.5">
                    {a.status === 'CHECKED_IN' && (
                      <button
                        onClick={() => action.mutate({ id: a.id, kind: 'start' })}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
                      >
                        Start consultation
                      </button>
                    )}
                    {a.status === 'IN_CONSULTATION' && (
                      <button
                        onClick={() => action.mutate({ id: a.id, kind: 'complete' })}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
                      >
                        Complete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
