/**
 * Standard success envelope — API Standards §2.
 * Success: { data, meta? }
 */
export function ok(res: import('express').Response, data: unknown, status = 200, meta?: unknown) {
  return res.status(status).json(meta === undefined ? { data } : { data, meta });
}

export function created(res: import('express').Response, data: unknown) {
  return ok(res, data, 201);
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total };
}
