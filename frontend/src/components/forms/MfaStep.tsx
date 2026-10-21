import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth, type AuthUser } from '../../hooks/useAuth.js';

/**
 * Shared MFA step — handles both arms of SEC-04 / AC-07:
 *  - enrolled=false → setup (QR/secret) then first code verification
 *  - enrolled=true  → code entry only
 * On success the server returns full permissions and the dashboard loads.
 */
export function MfaStep({ enrolled }: { enrolled: boolean }) {
  const [phase, setPhase] = useState<'setup' | 'verify'>(enrolled ? 'verify' : 'setup');
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const enroll = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { otpauthUri: string; secret: string } }>(
        EP.MFA_ENROLL,
        {}
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      setSecret(data.secret);
      setPhase('verify');
    },
    onError: (err) => setError(extractError(err).message),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const res = await api.post<{
        data: {
          mfaComplete: boolean;
          user: { id: string; email: string; role: string };
          permissions: string[];
        };
      }>(EP.MFA_VERIFY, { code });
      return res.data.data;
    },
    onSuccess: (data) => {
      setAuth({
        id: data.user.id,
        email: data.user.email,
        role: data.user.role,
        permissions: data.permissions,
      } satisfies AuthUser);
      navigate('/dashboard', { replace: true });
    },
    onError: (err) => setError(extractError(err).message),
  });

  const field =
    'mt-1 w-full rounded-md border px-3 py-2 text-sm tracking-widest focus:border-primary-500 focus:outline-none';

  if (phase === 'setup') {
    return (
      <div>
        <h2 className="text-lg font-bold">Set up two-factor authentication</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your role requires an extra security step. Add this account to your authenticator app
          (Google Authenticator, Authy, etc.).
        </p>
        {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          onClick={() => enroll.mutate()}
          disabled={enroll.isPending}
          className="mt-4 w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {enroll.isPending ? 'Generating…' : 'Begin setup'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold">
        {enrolled && !secret ? 'Enter your verification code' : 'Confirm your authenticator'}
      </h2>

      {secret && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-700">Add this key to your authenticator app:</p>
          <p className="mt-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{secret}</p>
          <p className="mt-1 text-xs text-slate-500">
            This key is shown only once. Store it safely or re-add it now.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          verify.mutate();
        }}
        className="mt-4 space-y-3"
      >
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-slate-700">
            6-digit code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={field}
          />
        </div>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={verify.isPending || code.length !== 6}
          className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {verify.isPending ? 'Verifying…' : 'Verify and continue'}
        </button>
      </form>
    </div>
  );
}
