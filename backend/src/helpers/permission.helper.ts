/**
 * permission.helper — reusable server-side permission predicate (Backend Spec §1).
 * Authorization is always evaluated on the server (C-02); the client never decides.
 */

/** True when the actor holds at least one of the required permission strings. */
export function hasAnyPermission(
  granted: readonly string[] | undefined,
  needed: string | string[]
): boolean {
  const required = Array.isArray(needed) ? needed : [needed];
  const held = granted ?? [];
  return required.some((p) => held.includes(p));
}
