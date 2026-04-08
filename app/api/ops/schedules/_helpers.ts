// app/api/ops/schedules/_helpers.ts
import { db } from '@/lib/db';
import { users, userRoles, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface OpsActor {
  id:     string;
  role:   string | null;
  areaId: number | null;
}

/**
 * Look up an actor and confirm they have the 'ops' role.
 * Returns null if the user is not OPS.
 */
export async function getOpsActor(userId: string): Promise<OpsActor | null> {
  const [row] = await db
    .select({
      id:     users.id,
      role:   userRoles.code,
      areaId: users.areaId,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || row.role !== 'ops') return null;
  return row as OpsActor;
}

/**
 * Verify the requested storeId is inside the OPS user's area.
 * Returns null if OK, or an error string if not.
 */
export async function assertStoreInActorArea(
  actor:   OpsActor,
  storeId: number,
): Promise<string | null> {
  if (!actor.areaId) return 'OPS user has no area assigned.';

  const [store] = await db
    .select({ areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                          return 'Store not found.';
  if (store.areaId !== actor.areaId)   return 'This store is not in your area.';
  return null;
}

/**
 * Parse and validate a storeId from query params or JSON body.
 */
export function parseStoreId(raw: string | number | null | undefined): { ok: true; id: number } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: false, error: 'storeId required.' };
  const n = Number(raw);
  if (isNaN(n)) return { ok: false, error: 'Invalid storeId.' };
  return { ok: true, id: n };
}