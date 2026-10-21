import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Doctor console (PH-04): open encounters → EMR (draft/finalize/amend with
 * versions) → prescriptions. Patients see only released entries (AC-27).
 */

interface Encounter {
  id: string;
  patientId: string;
  status: string;
  createdAt: string;
}

interface EmrEntry {
  id: string;
  status: string;
  content: { symptoms?: string; examination?: string; diagnosis?: string; notes?: string; plan?: string };
  version: number;
  releasedToPatient?: boolean;
}

interface Prescription {
  id: string;
  status: string;
  items: Array<{ medicine: string; dose: string; frequency: string; durationDays: number; quantity: number }>;
  createdAt: string;
}

const emptyForm = { symptoms: '', examination: '', diagnosis: '', notes: '', plan: '' };

export function ClinicalPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedEncounter, setSelectedEncounter] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [amendEntry, setAmendEntry] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [rxMedicine, setRxMedicine] = useState('');
  const [rxDose, setRxDose] = useState('');
  const [rxFrequency, setRxFrequency] = useState('');
  const [rxDays, setRxDays] = useState('5');
  const [rxQty, setRxQty] = useState('10');

  const isDoctor = user?.role === 'doctor';
  const canWriteEmr = user?.permissions.includes('emr.write') ?? false;
  const canPrescribe = user?.permissions.includes('prescription.create') ?? false;

  const encounters = useQuery({
    queryKey: ['encounters', 'open'],
    queryFn: async () => {
      const res = await api.get<{ data: Encounter[] }>(EP.ENCOUNTERS_OPEN);
      return res.data.data;
    },
    enabled: isDoctor,
  });

  const emr = useQuery({
    queryKey: ['emr', selectedEncounter],
    queryFn: async () => {
      const res = await api.get<{ data: EmrEntry[] }>(EP.ENCOUNTER_EMR(selectedEncounter));
      return res.data.data;
    },
    enabled: selectedEncounter !== '',
  });

  const prescriptions = useQuery({
    queryKey: ['prescriptions'],
    queryFn: async () => {
      const res = await api.get<{ data: Prescription[] }>(EP.PRESCRIPTIONS);
      return res.data.data;
    },
    enabled: isDoctor,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['emr'] });
    void queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
  };

  const writeEmr = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
      const res = await api.post(EP.ENCOUNTER_EMR(selectedEncounter), payload);
      return res.data;
    },
    onSuccess: () => {
      setForm(emptyForm);
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const emrAction = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'finalize' | 'release' }) =>
      api.post(kind === 'finalize' ? EP.EMR_FINALIZE(id) : EP.EMR_RELEASE(id), {}),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  const amend = useMutation({
    mutationFn: async () => {
      const payload = {
        ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')),
        reason: amendReason,
      };
      const res = await api.post(EP.EMR_AMEND(amendEntry), payload);
      return res.data;
    },
    onSuccess: () => {
      setForm(emptyForm);
      setAmendEntry('');
      setAmendReason('');
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const createRx = useMutation({
    mutationFn: async () => {
      const res = await api.post(EP.PRESCRIPTIONS, {
        encounterId: selectedEncounter,
        items: [{ medicine: rxMedicine, dose: rxDose, frequency: rxFrequency, durationDays: Number(rxDays), quantity: Number(rxQty) }],
      });
      return res.data;
    },
    onSuccess: () => {
      setRxMedicine('');
      setRxDose('');
      setRxFrequency('');
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const cancelRx = useMutation({
    mutationFn: async (id: string) => api.post(EP.PRESCRIPTION_CANCEL(id), { reason: 'Therapy changed by prescriber' }),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  return (
    <div>
      <h1 className="text-xl font-bold">Clinical console</h1>
      <p className="mt-1 text-sm text-slate-600">Encounters, EMR documentation, and prescriptions.</p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isDoctor && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Open encounters</h2>
          {(encounters.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No open encounters. Start one from an appointment.</p>
          ) : (
            <div className="mt-2 space-y-1">
              {(encounters.data ?? []).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEncounter(e.id)}
                  className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selectedEncounter === e.id ? 'border-primary-600 bg-primary-50' : 'hover:bg-slate-50'
                  }`}
                >
                  Encounter {e.id.slice(-6)} · patient {e.patientId.slice(-6)} · {new Date(e.createdAt).toLocaleString()}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {canWriteEmr && selectedEncounter && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Record EMR entry</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['symptoms', 'examination', 'diagnosis', 'notes', 'plan'] as const).map((k) => (
              <label key={k} className="text-xs font-medium capitalize text-slate-600">
                {k}
                <textarea
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => writeEmr.mutate()}
              disabled={writeEmr.isPending}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              Save draft
            </button>
          </div>

          <h3 className="mt-5 font-medium text-slate-700">Entries</h3>
          {(emr.data ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No entries yet.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {(emr.data ?? []).map((entry) => (
                <div key={entry.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">
                      v{entry.version} · {entry.status}
                      {entry.releasedToPatient ? ' · released to patient' : ''}
                    </span>
                    <div className="flex gap-1.5">
                      {entry.status === 'DRAFT' && (
                        <button onClick={() => emrAction.mutate({ id: entry.id, kind: 'finalize' })} className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">Finalize</button>
                      )}
                      {entry.status === 'FINALIZED' && !entry.releasedToPatient && (
                        <button onClick={() => emrAction.mutate({ id: entry.id, kind: 'release' })} className="rounded border px-2 py-1 text-xs text-green-700 hover:bg-green-50">Release to patient</button>
                      )}
                      {entry.status === 'FINALIZED' && (
                        <button onClick={() => setAmendEntry(entry.id)} className="rounded border px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">Amend</button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-slate-600">
                    {entry.content.diagnosis && <p><strong>Dx:</strong> {entry.content.diagnosis}</p>}
                    {entry.content.symptoms && <p><strong>Sx:</strong> {entry.content.symptoms}</p>}
                    {entry.content.plan && <p><strong>Plan:</strong> {entry.content.plan}</p>}
                  </div>
                  {amendEntry === entry.id && (
                    <div className="mt-2 rounded bg-amber-50 p-2">
                      <input
                        placeholder="Amendment reason (required)"
                        value={amendReason}
                        onChange={(e) => setAmendReason(e.target.value)}
                        className="w-full rounded border px-2 py-1 text-sm"
                      />
                      <p className="mt-1 text-xs text-slate-500">Fill any content fields above first, then submit the amendment.</p>
                      <button
                        onClick={() => amend.mutate()}
                        disabled={amend.isPending || amendReason.trim().length < 3}
                        className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Submit amendment
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {canPrescribe && selectedEncounter && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">New prescription</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            <input placeholder="Medicine" value={rxMedicine} onChange={(e) => setRxMedicine(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm sm:col-span-2" />
            <input placeholder="Dose" value={rxDose} onChange={(e) => setRxDose(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm" />
            <input placeholder="Frequency" value={rxFrequency} onChange={(e) => setRxFrequency(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Days" type="number" min={1} value={rxDays} onChange={(e) => setRxDays(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm" />
              <input placeholder="Qty" type="number" min={1} value={rxQty} onChange={(e) => setRxQty(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm" />
            </div>
          </div>
          <button
            onClick={() => createRx.mutate()}
            disabled={createRx.isPending || !rxMedicine || !rxDose || !rxFrequency}
            className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
          >
            Create prescription
          </button>

          <h3 className="mt-5 font-medium text-slate-700">My prescriptions</h3>
          <div className="mt-2 space-y-1">
            {(prescriptions.data ?? []).map((rx) => (
              <div key={rx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>
                  {rx.items.map((i) => `${i.medicine} ×${i.quantity}`).join(', ')}
                  <span className="ml-2 text-xs text-slate-500">{rx.status}</span>
                </span>
                {(rx.status === 'ACTIVE' || rx.status === 'PARTIALLY_DISPENSED') && (
                  <button onClick={() => cancelRx.mutate(rx.id)} className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50">Cancel</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
