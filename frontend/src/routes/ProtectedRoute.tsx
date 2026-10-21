import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

/**
 * Authentication guard — UX only. The server remains the gate (C-02): direct
 * URL entry to a protected page still receives 401/403 from the API.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
