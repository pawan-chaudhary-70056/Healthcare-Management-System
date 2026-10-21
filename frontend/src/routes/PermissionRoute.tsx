import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth.js';

/**
 * Permission-based guards — UX only. The server remains the gate (C-02).
 * Direct URL entry to an unauthorized page still gets 403 from the API.
 */
export function RequirePermission({ perm, children }: { perm: string; children: ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(perm)) return <NoAccess />;
  return <>{children}</>;
}

export function RequireAnyPermission({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { hasPermission } = useAuth();
  if (!perms.some((p) => hasPermission(p))) return <NoAccess />;
  return <>{children}</>;
}

export function NoAccess() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <h2 className="text-lg font-semibold text-red-700">Access denied</h2>
      <p className="mt-1 text-sm text-red-600">
        You don't have permission to view this page. Ask an administrator if you believe this is a mistake.
      </p>
    </div>
  );
}
