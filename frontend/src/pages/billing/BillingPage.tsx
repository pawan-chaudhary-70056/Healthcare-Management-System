import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Billing console (PH-07): consolidate charges → draft → issue → payments →
 * refunds/discounts → reconciliation. Money is displayed in minor units ÷100.
 */

interface Invoice {
  id: string;
  invoiceNo?: string;
  status: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  lines: Array<{ description: string; amountMinor: number }>;
}

interface Reconciliation {
  totals: { invoicedMinor: number; paidMinor: number; refundedMinor: number; outstandingMinor: number };
  byStatus: Record<string, number>;
}

const money = (minor: number) => (minor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export function BillingPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});

  const isBillingStaff = user?.permissions.includes('invoice.read.any') ?? false;
  const isPatient = user?.role === 'patient';
  const canRecord = user?.permissions.includes('payment.record') ?? false;

  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const res = await api.get<{ data: Invoice[] }>(EP.INVOICES);
      return res.data.data;
    },
  });

  const recon = useQuery({
    queryKey: ['reconciliation'],
    queryFn: async () => {
      const res = await api.get<{ data: Reconciliation }>(EP.BILLING_RECONCILIATION);
      return res.data.data;
    },
    enabled: isBillingStaff,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
  };

  const issue = useMutation({
    mutationFn: async (id: string) => api.post(EP.INVOICE_ISSUE(id)),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  const pay = useMutation({
    mutationFn: async ({ id, amountMinor }: { id: string; amountMinor: number }) =>
      api.post(EP.PAYMENTS, { invoiceId: id, amountMinor, method: 'CASH' }),
    onSuccess: () => {
      setPayAmount({});
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  return (
    <div>
      <h1 className="text-xl font-bold">{isPatient ? 'My invoices' : 'Billing'}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {isPatient ? 'Your invoices and outstanding balances.' : 'Invoices, payments, and reconciliation.'}
      </p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isBillingStaff && recon.data && (
        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          {[
            ['Invoiced', recon.data.totals.invoicedMinor],
            ['Collected', recon.data.totals.paidMinor],
            ['Refunded', recon.data.totals.refundedMinor],
            ['Outstanding', recon.data.totals.outstandingMinor],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{money(Number(value))}</p>
            </div>
          ))}
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-slate-700">Invoices</h2>
        {invoices.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : (invoices.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No invoices.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(invoices.data ?? []).map((inv) => (
              <div key={inv.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {inv.invoiceNo ?? inv.id.slice(-6)} · {money(inv.totalMinor)}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        inv.status === 'PAID' ? 'bg-green-100 text-green-700' :
                        inv.status === 'DRAFT' ? 'bg-slate-100 text-slate-600' :
                        'bg-amber-100 text-amber-700'
                      }`}>{inv.status}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Outstanding {money(inv.outstandingMinor)} · {inv.lines.length} line(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isBillingStaff && inv.status === 'DRAFT' && (
                      <button onClick={() => issue.mutate(inv.id)} className="rounded border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">Issue</button>
                    )}
                    {canRecord && inv.outstandingMinor > 0 && inv.status !== 'DRAFT' && (
                      <>
                        <input
                          type="number"
                          min={1}
                          placeholder="minor units"
                          value={payAmount[inv.id] ?? ''}
                          onChange={(e) => setPayAmount((p) => ({ ...p, [inv.id]: e.target.value }))}
                          className="w-28 rounded border px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => pay.mutate({ id: inv.id, amountMinor: Number(payAmount[inv.id]) })}
                          disabled={!payAmount[inv.id] || pay.isPending}
                          className="rounded border px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
                        >
                          Record payment
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
