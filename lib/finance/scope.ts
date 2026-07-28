// lib/finance/scope.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolves the current session into a Finance scope used by all Finance APIs.
//
//   - role.code === 'finance'  → ok: true
//   - role.code === 'it'       → ok: true  (IT can access everything)
//   - everyone else            → 401 / 403
//
// Finance users see all stores / all data (no area scoping needed for now).
// If you later need per-area Finance users, add an areaId field here.
// ─────────────────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { userRoles, users } from '@/lib/db/schema';

export type FinanceScope =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function resolveFinanceScope(): Promise<FinanceScope> {
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

  if (row.roleCode === 'finance' || row.roleCode === 'it') {
    return { ok: true, userId };
  }

  return { ok: false, status: 403, error: 'Forbidden: Finance access only.' };
}