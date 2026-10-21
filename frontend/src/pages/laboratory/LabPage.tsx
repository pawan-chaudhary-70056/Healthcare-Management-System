import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Laboratory console (PH-05): order queue → specimen → results → verify →
 * release, with separable duties enforced server-side (PERM-32 ≠ PERM-33).
 */

interface LabOrder {
  id: string;
  testName: string;
  testCode: string;
  status: string;
  priority: string;
  patientId: string;
  results?: {
    values: Array<{ name: string; value: string; unit?: string }>;
    isCritical?: boolean;
  } | null;
}

export function LabPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [specimen, setSpecimen] = useState<Record<string, { specimenId: string; type: string }>>({});
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  const [newTestCode, setNewTestCode] = useState('');
  const [newEncounterId, setNewEncounterId] = useState('');

  const isLab = user?.permissions.includes('lab.specimen.record') ?? false;
  const isDoctor = user?.permissions.includes('lab.order.create') ?? false;
  const isPatient = user?.role === 'patient';

  const orders = useQuery({
    queryKey: ['lab-orders'],
    queryFn: async () => {
      const res = await api.get<{ data: LabOrder[] }>(EP.LAB_ORDERS);
      return res.data.data;
    },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['lab-orders'] });

  const createOrder = useMutation({
    mutationFn: async () => {
      const res = await api.post(EP.LAB_ORDERS, { encounterId: newEncounterId, testCode: newTestCode });
      return res.data;
    },
    onSuccess: () => {
      setNewTestCode('');
      setNewEncounterId('');
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const act = useMutation({
    mutationFn: async ({ id, kind, body }: { id: string; kind: 'specimen' | 'results' | 'verify' | 'release' | 'ack'; body?: unknown }) => {
      const url =
        kind === 'specimen'
          ? EP.LAB_ORDER_SPECIMEN(id)
          : kind === 'results'
            ? EP.LAB_ORDER_RESULTS(id)
            : kind === 'verify'
              ? EP.LAB_ORDER_VERIFY(id)
              : kind === 'ack'
                ? EP.LAB_ORDER_CRITICAL_ACK(id)
                : EP.LAB_ORDER_RELEASE(id);
      const res = await api.post(url, body ?? {});
      return res.data;
    },
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  return (
    <div>
      <h1 className="text-xl font-bold">Laboratory</h1>
      <p className="mt-1 text-sm text-slate-600">
        {isPatient ? 'Your released results.' : 'Order pipeline: specimen → results → verification → release.'}
      </p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isDoctor && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Order a test</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input placeholder="Encounter ID" value={newEncounterId} onChange={(e) => setNewEncounterId(e.target.value)} className="w-64 rounded-md border px-2 py-1.5 text-sm" />
            <input placeholder="Test code (e.g. CBC)" value={newTestCode} onChange={(e) => setNewTestCode(e.target.value)} className="w-40 rounded-md border px-2 py-1.5 text-sm" />
            <button
              onClick={() => createOrder.mutate()}
              disabled={!newEncounterId || !newTestCode || createOrder.isPending}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Order
            </button>
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-slate-700">{isPatient ? 'Released results' : 'Orders'}</h2>
        {orders.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : (orders.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No orders.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(orders.data ?? []).map((o) => {
              const sp = specimen[o.id] ?? { specimenId: '', type: 'blood' };
              const val = resultValues[o.id] ?? '';
              return (
                <div key={o.id} className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {o.testName} <span className="ml-1 text-xs uppercase text-slate-400">{o.priority}</span>
                      </p>
                      <p className="text-xs text-slate-500">{o.status}{o.results?.isCritical ? ' · CRITICAL' : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {isLab && o.status === 'ORDERED' && (
                        <div className="flex gap-1">
                          <input placeholder="Specimen ID" value={sp.specimenId} onChange={(e) => setSpecimen((s) => ({ ...s, [o.id]: { ...sp, specimenId: e.target.value } }))} className="w-28 rounded border px-2 py-1 text-xs" />
                          <button onClick={() => act.mutate({ id: o.id, kind: 'specimen', body: sp })} className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">Record specimen</button>
                        </div>
                      )}
                      {isLab && ['SPECIMEN_COLLECTED', 'IN_PROCESS'].includes(o.status) && (
                        <div className="flex gap-1">
                          <input placeholder="value (e.g. 13.5)" value={val} onChange={(e) => setResultValues((r) => ({ ...r, [o.id]: e.target.value }))} className="w-28 rounded border px-2 py-1 text-xs" />
                          <button onClick={() => act.mutate({ id: o.id, kind: 'results', body: { values: [{ name: 'result', value: val }] } })} className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">Enter</button>
                        </div>
                      )}
                      {isLab && o.status === 'RESULT_ENTERED' && (
                        <button onClick={() => act.mutate({ id: o.id, kind: 'verify' })} className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">Verify</button>
                      )}
                      {isLab && o.status === 'VERIFIED' && (
                        <>
                          {o.results?.isCritical && (
                            <button onClick={() => act.mutate({ id: o.id, kind: 'ack' })} className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50">Ack critical</button>
                          )}
                          <button onClick={() => act.mutate({ id: o.id, kind: 'release', body: { releaseToPatient: true } })} className="rounded border px-2 py-1 text-xs text-green-700 hover:bg-green-50">Release</button>
                        </>
                      )}
                    </div>
                  </div>
                  {o.results && (isPatient ? o.status === 'RELEASED' : true) && (
                    <div className="mt-2 text-sm text-slate-600">
                      {o.results.values.map((v, i) => (
                        <span key={i} className="mr-3">{v.name}: <strong>{v.value}</strong>{v.unit ? ` ${v.unit}` : ''}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
