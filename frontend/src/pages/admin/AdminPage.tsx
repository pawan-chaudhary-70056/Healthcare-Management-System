import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Admin console (PH-08): audit log viewer (EP-73), facility policy settings
 * (EP-72), break-glass oversight incl. review (EP-76/77, AC-60/61).
 */

interface AuditItem {
  _id: string;
  at: string;
  action: string;
  module: string;
  actorRole?: string;
  outcome: string;
  resourceId?: string;
}

interface BreakGlass {
  id: string;
  requesterRole: string;
  status: string;
  reason: string;
  expiresAt: string;
}

interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  staffProfile?: { fullName?: string; department?: string };
}

interface BackupResult {
  backupId: string;
  generatedAt: string;
  digest: string;
  collections: Array<{ name: string; count: number }>;
}

interface DepartmentItem {
  _id: string;
  name: string;
  description?: string;
  publicVisible: boolean;
  active: boolean;
  orderIndex: number;
}

/** Staff roles (EP-70) — patients self-register (EP-04). */
const STAFF_ROLES = ['admin', 'receptionist', 'doctor', 'nurse', 'lab_tech', 'pharmacist', 'accountant'] as const;

const POLICY_KEYS = [
  'BOOKING_HORIZON_DAYS',
  'CANCELLATION_WINDOW_MINUTES',
  'NO_SHOW_GRACE_MINUTES',
  'WAITLIST_OFFER_MINUTES',
  'REMINDER_LEAD_HOURS',
] as const;

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [policyValue, setPolicyValue] = useState<Record<string, string>>({});

  const canAudit = user?.permissions.includes('audit.read.all') ?? false;
  const canSettings = user?.permissions.includes('settings.manage') ?? false;
  const canReview = user?.permissions.includes('breakglass.review') ?? false;
  const canUsers = user?.permissions.includes('user.manage') ?? false;
  const canAssign = user?.permissions.includes('role.assign') ?? false;
  const canBackup = user?.permissions.includes('backup.manage') ?? false;
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'receptionist', fullName: '' });
  const [roleDrafts, setRoleDrafts] = useState<Record<string, { role: string; currentPassword: string }>>({});
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  const auditLog = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const res = await api.get<{ data: AuditItem[] }>(`${EP.AUDIT_LOG}?limit=50`);
      return res.data.data;
    },
    enabled: canAudit || (user?.permissions.includes('audit.read.own-events') ?? false),
  });

  const policy = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(EP.POLICY_SETTINGS);
      return res.data.data;
    },
    enabled: canSettings,
  });

  const breakGlass = useQuery({
    queryKey: ['breakglass'],
    queryFn: async () => {
      const res = await api.get<{ data: BreakGlass[] }>(EP.BREAKGLASS);
      return res.data.data;
    },
    enabled: canReview,
  });

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUser[] }>(`${EP.ADMIN_USERS}?limit=100`);
      return res.data.data;
    },
    enabled: canUsers,
  });

  const departments = useQuery({
    queryKey: ['admin-departments'],
    queryFn: async () => {
      const res = await api.get<{ data: DepartmentItem[] }>(EP.ADMIN_DEPARTMENTS);
      return res.data.data;
    },
    enabled: canSettings,
  });

  const [newDept, setNewDept] = useState({ name: '', description: '' });

  const createDepartment = useMutation({
    mutationFn: async () =>
      api.post(EP.ADMIN_DEPARTMENTS, {
        name: newDept.name,
        description: newDept.description || undefined,
        orderIndex: (departments.data?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      setNewDept({ name: '', description: '' });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-departments'] });
      void queryClient.invalidateQueries({ queryKey: ['public', 'departments'] });
    },
    onError: (err) => setError(extractError(err).message),
  });

  const toggleDept = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`${EP.ADMIN_DEPARTMENTS}/${id}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-departments'] });
      void queryClient.invalidateQueries({ queryKey: ['public', 'departments'] });
    },
    onError: (err) => setError(extractError(err).message),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['policy'] });
    void queryClient.invalidateQueries({ queryKey: ['breakglass'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const createUser = useMutation({
    mutationFn: async () => api.post(EP.ADMIN_USERS, newUser),
    onSuccess: () => {
      setNewUser({ email: '', password: '', role: 'receptionist', fullName: '' });
      setError(null);
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(EP.ADMIN_USER_BY_ID(id), { status }),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  const assignRole = useMutation({
    mutationFn: async ({ id, role, currentPassword }: { id: string; role: string; currentPassword: string }) =>
      api.put(EP.ADMIN_USER_ROLE(id), { role, currentPassword }),
    onSuccess: (_res, vars) => {
      setRoleDrafts((d) => ({ ...d, [vars.id]: { role: '', currentPassword: '' } }));
      setError(null);
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const backup = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: BackupResult }>(EP.ADMIN_BACKUPS);
      return res.data.data;
    },
    onSuccess: (data) => {
      setBackupResult(data);
      setError(null);
    },
    onError: (err) => setError(extractError(err).message),
  });

  const setPolicy = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: number }) =>
      api.put(EP.POLICY_SETTING(key), { value }),
    onSuccess: () => {
      setPolicyValue({});
      invalidate();
    },
    onError: (err) => setError(extractError(err).message),
  });

  const review = useMutation({
    mutationFn: async (id: string) => api.post(EP.BREAKGLASS_REVIEW(id), { notes: 'Reviewed by administrator' }),
    onSuccess: invalidate,
    onError: (err) => setError(extractError(err).message),
  });

  return (
    <div>
      <h1 className="text-xl font-bold">Administration</h1>
      <p className="mt-1 text-sm text-slate-600">Audit oversight, facility policy, and emergency-access review.</p>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {canSettings && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Departments</h2>
          <p className="mt-1 text-xs text-slate-500">
            Clinical departments drive the public directory and booking filters.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <input
              placeholder="Department name"
              value={newDept.name}
              onChange={(e) => setNewDept((d) => ({ ...d, name: e.target.value }))}
              className="w-52 rounded border px-2 py-1 text-xs"
            />
            <input
              placeholder="Description (optional)"
              value={newDept.description}
              onChange={(e) => setNewDept((d) => ({ ...d, description: e.target.value }))}
              className="w-64 rounded border px-2 py-1 text-xs"
            />
            <button
              onClick={() => createDepartment.mutate()}
              disabled={!newDept.name || createDepartment.isPending}
              className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-60"
            >
              Add department
            </button>
          </div>
          <div className="mt-3 space-y-1">
            {(departments.data ?? []).map((d) => (
              <div key={d._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="text-slate-800">{d.name}</p>
                  {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => toggleDept.mutate({ id: d._id, patch: { publicVisible: !d.publicVisible } })}
                    className={`rounded px-1.5 py-0.5 ${d.publicVisible ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {d.publicVisible ? 'Public' : 'Hidden'}
                  </button>
                  <button
                    onClick={() => toggleDept.mutate({ id: d._id, patch: { active: !d.active } })}
                    className={`rounded px-1.5 py-0.5 ${d.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                  >
                    {d.active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {canSettings && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Facility policy</h2>
          <p className="mt-1 text-xs text-slate-500">Applied live across the system (booking horizons, windows, grace periods).</p>
          <div className="mt-3 space-y-2">
            {POLICY_KEYS.map((key) => (
              <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-64 font-mono text-xs text-slate-600">{key}</span>
                <span className="text-slate-500">{String(policy.data?.[key] ?? '—')}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="new value"
                  value={policyValue[key] ?? ''}
                  onChange={(e) => setPolicyValue((p) => ({ ...p, [key]: e.target.value }))}
                  className="w-24 rounded border px-2 py-1 text-xs"
                />
                <button
                  onClick={() => setPolicy.mutate({ key, value: Number(policyValue[key]) })}
                  disabled={!policyValue[key] || setPolicy.isPending}
                  className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                >
                  Update
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {canReview && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Emergency access (break-glass)</h2>
          {(breakGlass.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No requests.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {(breakGlass.data ?? []).map((bg) => (
                <div key={bg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div>
                    <p className="text-slate-800">{bg.reason}</p>
                    <p className="text-xs text-slate-500">
                      {bg.requesterRole} · expires {new Date(bg.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${
                      bg.status === 'ACTIVE' ? 'bg-red-100 text-red-700' :
                      bg.status === 'REVIEWED' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{bg.status}</span>
                    {['REVOKED', 'EXPIRED'].includes(bg.status) && (
                      <button onClick={() => review.mutate(bg.id)} className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">Review</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {canUsers && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Users &amp; roles</h2>
          <p className="mt-1 text-xs text-slate-500">
            Staff accounts only — patients self-register. Role changes require your password (re-authentication).
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <input
              type="email"
              placeholder="email"
              value={newUser.email}
              onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
              className="rounded border px-2 py-1 text-xs"
            />
            <input
              type="text"
              placeholder="full name"
              value={newUser.fullName}
              onChange={(e) => setNewUser((u) => ({ ...u, fullName: e.target.value }))}
              className="rounded border px-2 py-1 text-xs"
            />
            <input
              type="password"
              placeholder="initial password"
              value={newUser.password}
              onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
              className="rounded border px-2 py-1 text-xs"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
              className="rounded border px-2 py-1 text-xs"
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              onClick={() => createUser.mutate()}
              disabled={!newUser.email || !newUser.password || createUser.isPending}
              className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-60"
            >
              Create user
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {(users.data ?? []).map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <p className="text-slate-800">
                    {u.email} <span className="text-xs text-slate-500">{u.staffProfile?.fullName}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {u.role} · <span className={u.status === 'ACTIVE' ? 'text-green-700' : 'text-red-700'}>{u.status}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {u.status === 'ACTIVE' ? (
                    <button
                      onClick={() => setStatus.mutate({ id: u.id, status: 'SUSPENDED' })}
                      className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus.mutate({ id: u.id, status: 'ACTIVE' })}
                      className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50"
                    >
                      Reactivate
                    </button>
                  )}
                  {canAssign && (
                    <>
                      <select
                        value={roleDrafts[u.id]?.role ?? u.role}
                        onChange={(e) =>
                          setRoleDrafts((d) => ({
                            ...d,
                            [u.id]: { role: e.target.value, currentPassword: d[u.id]?.currentPassword ?? '' },
                          }))
                        }
                        className="rounded border px-2 py-1 text-xs"
                      >
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <input
                        type="password"
                        placeholder="your password"
                        value={roleDrafts[u.id]?.currentPassword ?? ''}
                        onChange={(e) =>
                          setRoleDrafts((d) => ({
                            ...d,
                            [u.id]: { role: d[u.id]?.role ?? u.role, currentPassword: e.target.value },
                          }))
                        }
                        className="w-32 rounded border px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() =>
                          assignRole.mutate({
                            id: u.id,
                            role: roleDrafts[u.id]?.role ?? u.role,
                            currentPassword: roleDrafts[u.id]?.currentPassword ?? '',
                          })
                        }
                        disabled={!roleDrafts[u.id]?.currentPassword || assignRole.isPending}
                        className="rounded border px-2 py-1 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                      >
                        Assign role
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {canBackup && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Backups</h2>
          <p className="mt-1 text-xs text-slate-500">
            Trigger a verified backup manifest (per-collection counts + digest); the action is logged.
          </p>
          <button
            onClick={() => backup.mutate()}
            disabled={backup.isPending}
            className="mt-3 rounded border px-3 py-1 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-60"
          >
            {backup.isPending ? 'Running…' : 'Trigger backup'}
          </button>
          {backupResult && (
            <div className="mt-3 rounded-md border bg-slate-50 p-3 text-xs text-slate-600">
              <p>
                <span className="font-mono">{backupResult.backupId}</span> ·{' '}
                {new Date(backupResult.generatedAt).toLocaleString()}
              </p>
              <p className="mt-1 break-all font-mono">sha256: {backupResult.digest}</p>
              <p className="mt-1">{backupResult.collections.length} collections captured</p>
            </div>
          )}
        </section>
      )}

      {(canAudit || (user?.permissions.includes('audit.read.own-events') ?? false)) && (
        <section className="mt-6 rounded-lg border bg-white p-4">
          <h2 className="font-semibold text-primary-700">Audit log</h2>
          <div className="mt-2 max-h-96 space-y-1 overflow-y-auto">
            {(auditLog.data ?? []).map((item) => (
              <div key={item._id} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs">
                <span className="font-mono text-slate-700">{item.action}</span>
                <span className="text-slate-500">
                  {new Date(item.at).toLocaleString()} · {item.actorRole ?? '—'} · {item.outcome}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
