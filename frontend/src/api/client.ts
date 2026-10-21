import axios, { AxiosError } from 'axios';
import { API_BASE_URL } from '../utils/env.js';

/**
 * Single API client — Frontend Spec §1.
 * - HTTP-only cookie sessions (credentials: include)
 * - auto-401 → save attempted route → redirect to login (UX rule 7)
 * - standard error envelope parsing
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let redirectHandler: ((path: string) => void) | null = null;

/** Router registers itself so the client can redirect on session expiry. */
export function setUnauthorizedRedirect(handler: (path: string) => void): void {
  redirectHandler = handler;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Array<{ field: string; issue: string; suggestions?: string[] }>;
  traceId?: string;
}

export function extractError(err: unknown): ApiErrorPayload {
  const axiosError = err as AxiosError<{ error?: ApiErrorPayload }>;
  const payload = axiosError?.response?.data?.error;
  if (payload) return payload;
  return {
    code: 'NETWORK_ERROR',
    message: 'Unable to reach the server. Please try again.',
  };
}

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ error?: ApiErrorPayload }>) => {
    const status = error.response?.status;
    if (status === 401) {
      const current = window.location.pathname + window.location.search;
      const onPublicAuthPage =
        window.location.pathname === '/login' || window.location.pathname === '/register';
      if (!onPublicAuthPage) {
        window.sessionStorage.setItem('hms.postLoginRedirect', current);
        redirectHandler?.('/login');
      }
    }
    return Promise.reject(error);
  }
);
