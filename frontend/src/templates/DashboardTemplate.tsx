import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { EP } from '../api/endpoints.js';
import { useAuth } from '../hooks/useAuth.js';
import type { ReactNode } from 'react';

interface NavItem {
  to: string;
  label: string;
  permission?: string; // sidebar hides what the role can't use (UX hiding only)
}

/**
 * Authenticated shell — sidebar derives from SERVER permissions via /auth/me
 * (Navigation rule 1). PH-03 adds the appointments module sections; later
 * phases append their own.
 */
const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'General',
    items: [{ to: '/dashboard', label: 'Dashboard' }],
  },
  {
    title: 'Appointments',
    items: [
      {
        to: '/dashboard/appointments',
        label: 'My appointments',
        permission: 'appointment.create.own',
      },
      {
        to: '/dashboard/reception',
        label: 'Reception',
        permission: 'appointment.create.any',
      },
      {
        to: '/dashboard/schedule',
        label: 'My schedule',
        permission: 'appointment.read.own-schedule',
      },
    ],
  },
  {
    title: 'Clinical',
    items: [
      {
        to: '/dashboard/clinical',
        label: 'Clinical console',
        permission: 'encounter.create',
      },
      {
        to: '/dashboard/lab',
        label: 'Laboratory',
        permission: 'lab.specimen.record',
      },
      {
        to: '/dashboard/pharmacy',
        label: 'Pharmacy',
        permission: 'prescription.validate',
      },
    ],
  },
  {
    title: 'Finance & Admin',
    items: [
      {
        to: '/dashboard/billing',
        label: 'Billing',
        permission: 'invoice.read.any',
      },
      {
        to: '/dashboard/lab',
        label: 'My results',
        permission: 'lab.result.read.released.own',
      },
      {
        to: '/dashboard/admin',
        label: 'Administration',
        permission: 'settings.manage',
      },
    ],
  },
];

export function DashboardTemplate() {
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: async () => api.post(EP.LOGOUT),
    onSuccess: async () => {
      clearAuth();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 flex-col border-r bg-white md:flex">
        <div className="border-b px-4 py-4">
          <p className="text-sm font-bold text-primary-700">City General Hospital</p>
          <p className="text-xs text-slate-500">Staff & patient portal</p>
        </div>
        <nav className="flex-1 space-y-4 p-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </p>
              {section.items
                .filter((item) => !item.permission || user?.permissions.includes(item.permission))
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `block rounded-md px-2 py-1.5 text-sm ${
                        isActive ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-slate-500">Session secured · HTTP-only cookie</div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-white px-4 py-3">
          <p className="text-sm font-semibold text-slate-700">Dashboard</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user?.email} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase">{user?.role}</span>
            </span>
            <button
              onClick={() => logout.mutate()}
              className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export type { ReactNode };
