// app/api/ops/tasks/_helpers.ts
import { db } from '@/lib/db';
import { users, userRoles, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface OpsActor {
  id:     string;
  role:   string | null;
  areaId: number | null;
}

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
  if (!store)                        return 'Store not found.';
  if (store.areaId !== actor.areaId) return 'This store is not in your area.';
  return null;
}

export function parseStoreId(raw: string | null | undefined): { ok: true; id: number } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: false, error: 'storeId required.' };
  const n = Number(raw);
  if (isNaN(n)) return { ok: false, error: 'Invalid storeId.' };
  return { ok: true, id: n };
}

export function parseDate(raw: string | null | undefined): { ok: true; date: Date } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'date required.' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let d: Date;
  if (m) {
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  } else {
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return { ok: false, error: 'Invalid date.' };
  return { ok: true, date: d };
}