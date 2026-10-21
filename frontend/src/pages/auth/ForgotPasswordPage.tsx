import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';

/** EP-05 UI — the server always returns the same neutral message (AC-06). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      await api.post(EP.FORGOT_PASSWORD, { email });
    },
    onSuccess: () => setSent(true),
  });

  if (sent) {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-lg border p-6 text-center">
        <h1 className="text-xl font-bold">Check your inbox</h1>
        <p className="mt-2 text-sm text-slate-600">
          If the address is registered, a reset link has been sent. Please check your inbox.
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm text-primary-600 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      <p className="mt-1 text-sm text-slate-600">
        Enter your email and we'll send you a reset link.
      </p>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit.mutate();
        }}
        className="mt-6 space-y-4 rounded-lg border p-6"
      >
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
        <button
          type="submit"
          disabled={submit.isPending}
          className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {submit.isPending ? 'Sending…' : 'Send reset link'}
        </button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-primary-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
