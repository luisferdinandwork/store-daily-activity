// lib/auth/guards.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side authorisation helpers — the layer that does NOT depend on the
// proxy. `proxy.ts` is a fast coarse gate, but Next.js has shipped proxy /
// middleware bypasses before, so pages and route handlers must enforce access
// themselves. These helpers are that enforcement.
//
// Note: `getServerSession` re-runs the `jwt` callback in lib/auth.ts, which
// re-validates the user against the DB (deactivated user / disabled role ⇒ no
// session at all), so `session.user.role` here is fresh to within ~30s.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { homePathFor, isKnownRole, pageRolesFor, type AppRoleCode } from '@/lib/auth/access';

export type GuardedUser = {
  id: string;
  nik: string;
  role: AppRoleCode;
  employeeType: string | null;
  homeStoreId: number | null;
  areaId: number | null;
};

export type ApiGuardResult =
  | { ok: true; user: GuardedUser }
  | { ok: false; response: NextResponse };

/**
 * Route-handler guard.
 *
 *   const guard = await guardApi(['finance', 'it']);
 *   if (!guard.ok) return guard.response;
 *   const { user } = guard;
 *
 * Omit `roles` to require only "signed in".
 */
export async function guardApi(roles?: readonly AppRoleCode[]): Promise<ApiGuardResult> {
  const session = await getServerSession(authOptions);
  const u = session?.user;

  if (!u?.id || !isKnownRole(u.role)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (roles && !roles.includes(u.role)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user: {
      id: u.id,
      nik: u.nik,
      role: u.role,
      employeeType: (u.employeeType as string | null) ?? null,
      homeStoreId: u.homeStoreId ?? null,
      areaId: u.areaId ?? null,
    },
  };
}

/**
 * Server-component / layout guard for a role-restricted panel.
 *   - no session          → /login
 *   - wrong role          → that user's own home panel
 * Uses the same rules as the proxy (lib/auth/access.ts), so the two never disagree
 * (a disagreement would cause a redirect loop).
 */
export async function requirePanel(
  panel: '/it' | '/ops' | '/finance' | '/audit' | '/pic' | '/employee',
) {
  const session = await getServerSession(authOptions);
  const u = session?.user;

  if (!session || !u?.id || !isKnownRole(u.role)) redirect('/login');

  const allowed = pageRolesFor(panel) ?? [];
  if (!allowed.includes(u.role)) redirect(homePathFor(u.role, u.employeeType));

  return session;
}
