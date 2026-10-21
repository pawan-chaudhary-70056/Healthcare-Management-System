import type { Request } from 'express';

/**
 * actor.helper — shared request-actor types + helpers (Backend Spec helpers/).
 * The actor is always derived from the server-loaded session (requireAuth),
 * never from client-supplied fields (C-02).
 *
 * These are the ONLY definitions of the actor/request-meta shapes: controllers
 * and services import them instead of re-declaring local copies.
 */

/** The authenticated principal, derived only from the session (C-02). */
export type Actor = { id: string; role: string };

/** Minimal request metadata carried into audit entries (A-01). */
export type ReqMeta = { ip?: string; headers?: Record<string, unknown> };

/**
 * Structural request shape — controllers hold narrowed request types (they only
 * need user/params/query/body); requiring the full Express Request forced every
 * call site into `as unknown as` double casts. Anything with these members is
 * accepted; requireAuth guarantees `user` is set on protected routes.
 */
export type ActorRequest = {
  user?: { id: string; role: string };
  params: Record<string, string>;
  ip?: string;
  headers: Record<string, unknown>;
};

/** Extract the authenticated actor from the request. */
export function actorOf(req: Request | ActorRequest): Actor {
  const user = (req as ActorRequest).user;
  if (!user) throw new Error('actorOf called on an unauthenticated request');
  return { id: user.id, role: user.role };
}

/** Minimal request metadata for audit entries. */
export function reqMeta(req: Request | ActorRequest): ReqMeta {
  return {
    ip: (req as ActorRequest).ip,
    headers: (req as ActorRequest).headers,
  };
}
