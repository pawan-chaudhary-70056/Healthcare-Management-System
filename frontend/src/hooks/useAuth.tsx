import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * AuthContext — MEMORY ONLY. No tokens/roles in localStorage or sessionStorage
 * (Auth Flow §4, Frontend Spec §6). Session lives in the HTTP-only cookie.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  hasPermission: (perm: string) => boolean;
  setAuth: (user: AuthUser) => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const setAuth = useCallback((u: AuthUser) => setUser(u), []);
  const clearAuth = useCallback(() => setUser(null), []);
  const hasPermission = useCallback(
    (perm: string) => user?.permissions.includes(perm) ?? false,
    [user]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      hasPermission,
      setAuth,
      clearAuth,
    }),
    [user, hasPermission, setAuth, clearAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
