/**
 * Shared plumbing for route handlers: auth, capability checks, and error
 * shapes that never leak stack traces or credentials to the client.
 */

import { authorizeRequest, can, deny, type Caller } from './auth';
import { SheetsNotConfiguredError, credentialsPresent } from './sheets';
import { stableIdempotencyKey } from './core';
import { seenIdempotencyKey } from './audit';

export type Handler = (req: Request, caller: Caller) => Promise<Response>;

export function ok(data: unknown, init?: ResponseInit): Response {
  return Response.json({ ok: true, ...(data as object) }, init);
}

export function fail(message: string, status = 400, extra?: object): Response {
  return Response.json({ ok: false, error: message, ...extra }, { status });
}

/** Wrap a handler with authentication and a capability requirement. */
export function guarded(capability: string, handler: Handler) {
  return async (req: Request): Promise<Response> => {
    let caller: Caller | null;
    try {
      caller = await authorizeRequest(req);
    } catch {
      return deny(401, 'Authentication failed.');
    }
    if (!caller) {
      return deny(401, 'Sign in, or supply a valid API bearer token.');
    }
    if (!can(caller.role, capability)) {
      return deny(403, `Your role (${caller.role}) cannot ${capability}.`);
    }
    try {
      return await handler(req, caller);
    } catch (err) {
      return handleError(err);
    }
  };
}

export function handleError(err: unknown): Response {
  if (err instanceof SheetsNotConfiguredError) {
    return fail(err.message, 503, { code: 'SHEETS_NOT_CONFIGURED' });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  // Google API errors carry useful, non-sensitive detail worth surfacing.
  const status = /permission|forbidden/i.test(message) ? 403
    : /not found/i.test(message) ? 404
    : 500;
  return fail(message, status);
}

export function requireSheets(): void {
  if (!credentialsPresent()) throw new SheetsNotConfiguredError();
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/* ------------------------------------------------------------------ *
 * Idempotency
 * ------------------------------------------------------------------ */

/**
 * Resolve the idempotency key for a write.
 *
 * An explicit `Idempotency-Key` header wins. Otherwise one is derived from the
 * caller, the action and the payload, so a client that retries the identical
 * request — with or without a header — collapses onto the same write.
 */
export function idempotencyKeyFor(
  req: Request, caller: Caller, action: string, payload: unknown,
): string {
  const header = req.headers.get('idempotency-key');
  if (header && header.trim()) return header.trim();
  return stableIdempotencyKey(caller.source, action, payload);
}

/**
 * Short-circuit a write whose key has already been applied.
 * Returns a response when the request is a replay, or null to continue.
 */
export async function replayGuard(key: string): Promise<Response | null> {
  if (!key) return null;
  if (!(await seenIdempotencyKey(key))) return null;
  return Response.json({
    ok: true,
    duplicate: true,
    applied: false,
    idempotencyKey: key,
    message: 'This request was already applied. No second write was made.',
  });
}
