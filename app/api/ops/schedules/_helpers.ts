// app/api/ops/schedules/_helpers.ts
import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface OpsActor {
  id:     string;
  role:   string | null;
  areaId: number | null;
  /**
   * true when this actor is allowed to operate across every area.
   * Resolved from either:
   *   • role.code === 'admin'
   *   • employeeType.code === 'ops_ho'   (Head Office OPS)
   */
  isHO:   boolean;
}

/**
 * Look up an actor and confirm they are allowed to use OPS schedule routes.
 * Returns null when the user is neither OPS nor admin.
 *
 * NOTE: HO users intentionally have `areaId = null`. Do not reject them on
 * that basis — use `isHO` instead.
 */
export async function getOpsActor(userId: string): Promise<OpsActor | null> {
  const [row] = await db
    .select({
      id:               users.id,
      role:             userRoles.code,
      areaId:           users.areaId,
      employeeTypeCode: employeeTypes.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  if (row.role !== 'ops' && row.role !== 'admin') return null;

  const isHO = row.role === 'admin' || row.employeeTypeCode === 'ops_ho';

  return {
    id:     row.id,
    role:   row.role,
    areaId: row.areaId,
    isHO,
  };
}

/**
 * Verify the requested storeId is reachable for this actor.
 *
 *   • HO        → any store OK
 *   • Area OPS  → must have areaId, and the store's areaId must match
 *
 * Returns null if OK, or an error string describing the failure.
 */
export async function assertStoreInActorArea(
  actor:   OpsActor,
  storeId: number,
): Promise<string | null> {
  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Store not found.';

  if (actor.isHO) return null;

  if (!actor.areaId) return 'OPS user has no area assigned.';
  if (store.areaId !== actor.areaId) return 'This store is not in your area.';
  return null;
}

/**
 * Parse and validate a storeId from query params or JSON body.
 * Accepts numeric input or numeric string (e.g. from FormData / query string).
 */
export function parseStoreId(
  raw: string | number | null | undefined,
): { ok: true; id: number } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: false, error: 'storeId required.' };
  const n = Number(raw);
  if (isNaN(n) || !Number.isFinite(n)) return { ok: false, error: 'Invalid storeId.' };
  return { ok: true, id: n };
}