// lib/audit/scope.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolves the current session into an Audit scope used by all Audit APIs.
//
//   - role.code === 'audit'  → ok: true
//   - role.code === 'it'     → ok: true  (IT can access everything)
//   - everyone else          → 401 / 403
//
// Audit users see all stores / all data (no area scoping).
// ─────────────────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { userRoles, users } from '@/lib/db/schema';

export type AuditScope =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function resolveAuditScope(): Promise<AuditScope> {
  const session = await getServerSession(authOptions);
  const userId  = session?.user?.id as string | undefined;

  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const [row] = await db
    .select({ roleCode: userRoles.code })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (row.roleCode === 'audit' || row.roleCode === 'it') {
    return { ok: true, userId };
  }

  return { ok: false, status: 403, error: 'Forbidden: Audit access only.' };
}
