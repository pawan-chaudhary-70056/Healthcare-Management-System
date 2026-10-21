import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';

/** EP-06 UI — single-use token + strong password; sessions are invalidated after. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      await api.post(EP.RESET_PASSWORD, { token, password });
    },
    onSuccess: () => setDone(true),
    onError: (err) => setError(extractError(err).message),
  });

  if (done) {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-lg border p-6 text-center">
        <h1 className="text-xl font-bold">Password updated</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your password has been changed and other sessions were signed out.
        </p>
        <Link
          to="/login"
          className="mt-4 inline-block rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const field =
    'mt-1 w-full rounded-md border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

  return (
    <div className="mx-auto mt-8 max-w-md">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      {!token && (
        <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This link is missing its reset token. Please request a new link.
        </p>
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (password !== confirm) {
            setError('Passwords do not match.');
            return;
          }
          submit.mutate();
        }}
        className="mt-6 space-y-4 rounded-lg border p-6"
      >
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <p className="mt-1 text-xs text-slate-500">
            At least 10 characters with upper case, lower case, and a digit.
          </p>
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={field}
          />
        </div>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={submit.isPending || !token}
          className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {submit.isPending ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
