import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth, type AuthUser } from '../../hooks/useAuth.js';
import { MfaStep } from '../../components/forms/MfaStep.js';

interface LoginResponse {
  data: {
    mfaRequired: boolean;
    enrolled?: boolean;
    user: { id: string; email: string; role: string };
    permissions?: string[];
  };
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<{ enrolled: boolean; email: string; role: string } | null>(
    null
  );
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: async () => {
      const res = await api.post<LoginResponse>(EP.LOGIN, { email, password });
      return res.data.data;
    },
    onSuccess: (data) => {
      if (data.mfaRequired) {
        // SEC-04 / AC-07: privileged role — complete MFA before the dashboard.
        setMfaState({ enrolled: data.enrolled ?? false, email: data.user.email, role: data.user.role });
        return;
      }
      setAuth({
        id: data.user.id,
        email: data.user.email,
        role: data.user.role,
        permissions: data.permissions ?? [],
      } satisfies AuthUser);
      const saved = window.sessionStorage.getItem('hms.postLoginRedirect');
      window.sessionStorage.removeItem('hms.postLoginRedirect');
      navigate(saved ?? '/dashboard', { replace: true });
    },
    onError: (err) => setError(extractError(err).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate();
  }

  if (mfaState) {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-lg border p-6">
        <MfaStep enrolled={mfaState.enrolled} />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Access your staff or patient portal.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-lg border p-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>

        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-primary-600 hover:underline">
            Forgot password?
          </Link>
          <Link to="/register" className="text-primary-600 hover:underline">
            Create account
          </Link>
        </div>
      </form>
    </div>
  );
}
