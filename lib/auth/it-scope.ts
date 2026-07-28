// lib/auth/it-scope.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolves the current session into an IT scope used by IT-only APIs
// (BC credentials, task management, shift & tasks config, store geofence).
//
//   - role === 'it'  → ok: true
//   - everyone else  → 401 / 403
//
// Role is already carried in the JWT session, so this is a cheap
// session-only check — no DB hit needed, mirroring how client-side pages
// already read `session.user.role` for their own guards.
// ─────────────────────────────────────────────────────────────────────────────

import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';

export type ItScope =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function resolveItScope(): Promise<ItScope> {
  const session = await getServerSession(authOptions);
  const userId  = session?.user?.id as string | undefined;

  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (session?.user?.role !== 'it') {
    return { ok: false, status: 403, error: 'Forbidden: IT access only.' };
  }

  return { ok: true, userId };
}
