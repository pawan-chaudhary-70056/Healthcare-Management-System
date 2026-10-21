import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Pharmacy console (PH-06): validation queue → FEFO dispense → inventory
 * (receipts, adjustments, quarantine/recall, reorder report).
 */

interface QueueRx {
  id: string;
  patientId: string;
  status: string;
  items: Array<{ medicine: string; quantity: number }>;
}

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  status: string;
  expiryDate: string;
}

export function PharmacyPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [drugCode, setDrugCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [quantity, setQuantity] = useState('');

  const isPharmacist = user?.permissions.includes('prescription.dispense') ?? false;
  const canManage = user?.permissions.includes('pharmacy.inventory.manage') ?? false;

  const queue = useQuery({
    queryKey: ['pharmacy-queue'],
    queryFn: async () => {
      const res = await api.get<{ data: QueueRx[] }>(EP.PHARMACY_QUEUE);
      return res.data.data;
    },
    enabled: isPharmacist,
  });

  const batches = useQuery({
    queryKey: ['pharmacy-batches'],
    queryFn: async () => {
      const res = await api.get<{ data: Batch[] }>(EP.PHARMACY_BATCHES);
      return res.data.data;
    },
    enabled: canManage,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['pharmacy-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['pharmacy-batches'] });
  };

  const dispense = useMutation({
    mutationFn: async (id: string) => api.post(EP.PHARMACY_DISPENSE(id)),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  const receive = useMutation({
    mutationFn: async () =>
      api.post(EP.PHARMACY_RECEIVE, { drugCode, batchNo, expiryDate: expiry, quantity: Number(quantity) }),
    onSuccess: () => {
      setDrugCode('');
      setBatchNo('');
      setQuantity('');
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const batchAction = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'quarantine' | 'recall' }) =>
      api.post(kind === 'quarantine' ? EP.PHARMACY_BATCH_QUARANTINE(id) : EP.PHARMACY_BATCH_RECALL(id), {
        reason: 'Quality concern flagged by staff',
      }),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  return (
    <div>
      <h1 className="text-xl font-bold">Pharmacy</h1>
      <p className="mt-1 text-sm text-slate-600">Validation queue and stock control.</p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isPharmacist && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Validation queue</h2>
          {(queue.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No prescriptions waiting.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {(queue.data ?? []).map((rx) => (
                <div key={rx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">
                      {rx.items.map((i) => `${i.medicine} ×${i.quantity}`).join(', ')}
                    </p>
                    <p className="text-xs text-slate-500">Patient {rx.patientId.slice(-6)} · {rx.status}</p>
                  </div>
                  <button
                    onClick={() => dispense.mutate(rx.id)}
                    disabled={dispense.isPending}
                    className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    Dispense (FEFO)
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Receive stock</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input placeholder="Drug code" value={drugCode} onChange={(e) => setDrugCode(e.target.value)} className="w-36 rounded-md border px-2 py-1.5 text-sm" />
            <input placeholder="Batch no." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className="w-32 rounded-md border px-2 py-1.5 text-sm" />
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm" />
            <input type="number" min={1} placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-24 rounded-md border px-2 py-1.5 text-sm" />
            <button
              onClick={() => receive.mutate()}
              disabled={!drugCode || !batchNo || !expiry || !quantity || receive.isPending}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Receive
            </button>
          </div>

          <h3 className="mt-5 font-medium text-slate-700">Batches</h3>
          <div className="mt-2 space-y-1">
            {(batches.data ?? []).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>
                  <span className="font-mono">{b.batchNo}</span> · qty {b.quantity} · exp {new Date(b.expiryDate).toLocaleDateString()}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${b.status === 'AVAILABLE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{b.status}</span>
                </span>
                {b.status === 'AVAILABLE' && (
                  <div className="flex gap-1.5">
                    <button onClick={() => batchAction.mutate({ id: b.id, kind: 'quarantine' })} className="rounded border px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">Quarantine</button>
                    <button onClick={() => batchAction.mutate({ id: b.id, kind: 'recall' })} className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50">Recall</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
