/**
 * Authentication and role model.
 *
 * Access is allowlist-only: an email must appear in one of the role lists.
 * Roles are read from the environment so staff changes need no redeploy of code.
 *
 * API clients (ChatGPT Action, Claude MCP, webhooks) authenticate with a
 * bearer token instead of a session — see `authorizeRequest`.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import {
  CAPABILITIES as CORE_CAPABILITIES, ROLES as CORE_ROLES,
  can as coreCan, roleForEmail as coreRoleForEmail, type Role,
} from './core';

export const ROLES = CORE_ROLES;
export type { Role };

export const CAPABILITIES = CORE_CAPABILITIES;

export const can = coreCan;

export const roleForEmail = (email: string | null | undefined): Role | null =>
  coreRoleForEmail(email);

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

const providers = authConfigured()
  ? [Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    })]
  : [];

export const authOptions: NextAuthConfig = {
  providers,
  trustHost: true,
  pages: { signIn: '/login' },
  callbacks: {
    signIn({ user }) {
      return roleForEmail(user.email) !== null;
    },
    jwt({ token }) {
      token.role = roleForEmail(token.email as string | undefined) ?? 'readonly';
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: Role }).role = (token.role as Role) ?? 'readonly';
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

/* ------------------------------------------------------------------ *
 * Machine callers
 * ------------------------------------------------------------------ */

export type Caller = { user: string; role: Role; source: string };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Resolve the caller of an API route: a signed-in session, or a bearer token
 * for ChatGPT / Claude / webhook clients. Returns null when unauthenticated.
 */
export async function authorizeRequest(req: Request): Promise<Caller | null> {
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (bearer) {
    const expected = process.env.API_SHARED_TOKEN ?? '';
    if (expected && timingSafeEqual(bearer, expected)) {
      const source = req.headers.get('x-trt-source') ?? 'webhook';
      const user = req.headers.get('x-trt-user') ?? `api:${source}`;
      return { user, role: 'coordinator', source };
    }
    return null;
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const role = roleForEmail(email);
  if (!role) return null;
  return { user: email, role, source: 'webapp' };
}

/** 401/403 helper for route handlers. */
export function deny(status: 401 | 403, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}
