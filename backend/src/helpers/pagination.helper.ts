/** Pagination parsing — API Standards §1 (?page=1&limit=20, max 100). */
export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  skip: number;
} {
  const rawPage = Number(query.page ?? 1);
  const rawLimit = Number(query.limit ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), 100) : 20;
  return { page, limit, skip: (page - 1) * limit };
}
