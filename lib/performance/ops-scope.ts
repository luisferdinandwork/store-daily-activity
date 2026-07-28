// lib/performance/ops-scope.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolves the current OPS session into a scope used by performance-targets
// and settings APIs:
//
//   - IT        (userRoles.code === 'it')          → scope: 'all_areas'
//   - OPS HO    (employeeTypes.code === 'ops_ho')   → scope: 'all_areas'
//   - OPS Area  (employeeTypes.code === 'ops_area') → scope: 'area', limited to
//                                                      users.areaId
//   - everyone else                                 → not authorized
//
// Mirrors the area/all_areas scoping already used by
// /api/ops/tasks/progress.
// ─────────────────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { employeeTypes, userRoles, users } from '@/lib/db/schema';

export type OpsScope =
  | { ok: true; scope: 'all_areas'; userId: string; areaId: null }
  | { ok: true; scope: 'area'; userId: string; areaId: number }
  | { ok: false; status: 401 | 403; error: string };

export async function resolveOpsScope(): Promise<OpsScope> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const [row] = await db
    .select({
      areaId: users.areaId,
      employeeTypeCode: employeeTypes.code,
      roleCode: userRoles.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (row.roleCode === 'it' || row.employeeTypeCode === 'ops_ho') {
    return { ok: true, scope: 'all_areas', userId, areaId: null };
  }

  if (row.employeeTypeCode === 'ops_area') {
    if (row.areaId == null) {
      return { ok: false, status: 403, error: 'OPS Area user has no assigned area.' };
    }
    return { ok: true, scope: 'area', userId, areaId: row.areaId };
  }

  return { ok: false, status: 403, error: 'Forbidden: OPS access only.' };
}