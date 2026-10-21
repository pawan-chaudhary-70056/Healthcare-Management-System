import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, extractError } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';
import { useAuth, type AuthUser } from '../../hooks/useAuth.js';

interface RegisterResponse {
  data: { user: { id: string; email: string; role: string }; permissions: string[] };
}

/** S-06 Patient self-registration — creates Patient role only (server-enforced). */
export function RegisterPage() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const register = useMutation({
    mutationFn: async () => {
      const res = await api.post<RegisterResponse>(EP.REGISTER, {
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
      });
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

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    register.mutate();
  }

  const field =
    'mt-1 w-full rounded-md border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

  return (
    <div className="mx-auto mt-8 max-w-md">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">Register as a patient to book appointments online.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-lg border p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-slate-700">
              First name
            </label>
            <input
              id="firstName"
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-slate-700">
              Last name
            </label>
            <input
              id="lastName"
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={field}
            />
          </div>
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
            Phone (optional)
          </label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={field}
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
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={field}
          />
          <p className="mt-1 text-xs text-slate-500">
            At least 10 characters with upper case, lower case, and a digit.
          </p>
        </div>

        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={register.isPending}
          className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {register.isPending ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-center text-xs text-slate-500">
          By registering you agree to our privacy notice. Your medical data is stored securely and
          shared only with your care team.{' '}
          <Link to="/" className="underline">
            Learn more
          </Link>
        </p>
      </form>
    </div>
  );
}
