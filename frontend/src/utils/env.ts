/** Typed VITE_* env access — no secrets in the client (Frontend Spec §6). */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
