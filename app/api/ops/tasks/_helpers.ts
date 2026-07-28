// app/api/ops/tasks/_helpers.ts
import { db } from '@/lib/db';
import {
  users,
  userRoles,
  employeeTypes,
  stores,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export interface OpsActor {
  id: string;
  role: string | null;
  employeeType: string | null;
  areaId: number | null;
  isOpsHo: boolean;
  isOpsArea: boolean;
}

export async function getOpsActor(userId: string): Promise<OpsActor | null> {
  const [row] = await db
    .select({
      id: users.id,
      role: userRoles.code,
      employeeType: employeeTypes.code,
      areaId: users.areaId,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);

  if (!row) return null;

  const isIt = row.role === 'it';

  if (row.role !== 'ops' && !isIt) return null;

  const isOpsHo = isIt || row.employeeType === 'ops_ho';
  const isOpsArea = !isIt && row.employeeType === 'ops_area';

  /**
   * Only allow these 2 OPS types (IT counts as HO-equivalent).
   * This prevents generic ops users or wrongly configured users
   * from accessing the OPS task dashboard.
   */
  if (!isOpsHo && !isOpsArea) return null;

  return {
    id: row.id,
    role: row.role,
    employeeType: row.employeeType,
    areaId: row.areaId,
    isOpsHo,
    isOpsArea,
  };
}

export async function assertStoreInActorArea(
  actor: OpsActor,
  storeId: number,
): Promise<string | null> {
  /**
   * OPS HO can access every store.
   */
  if (actor.isOpsHo) return null;

  /**
   * OPS Area must have an assigned area.
   */
  if (!actor.areaId) {
    return 'OPS user has no area assigned.';
  }

  const [store] = await db
    .select({
      id: stores.id,
      areaId: stores.areaId,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    return 'Store not found.';
  }

  if (store.areaId !== actor.areaId) {
    return 'This store is not in your area.';
  }

  return null;
}

export function parseStoreId(
  raw: string | null | undefined,
): { ok: true; id: number } | { ok: false; error: string } {
  if (raw == null || raw.trim() === '') {
    return { ok: false, error: 'storeId required.' };
  }

  const n = Number(raw);

  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: 'Invalid storeId.' };
  }

  return { ok: true, id: n };
}

export function parseDate(
  raw: string | null | undefined,
): { ok: true; date: Date } | { ok: false; error: string } {
  if (!raw || raw.trim() === '') {
    return { ok: false, error: 'date required.' };
  }

  const value = raw.trim();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  let date: Date;

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    date = new Date(year, month - 1, day, 0, 0, 0, 0);

    /**
     * Prevent invalid dates like:
     * 2026-02-31 -> auto becomes March 3 in JS.
     */
    const isSameDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;

    if (!isSameDate) {
      return { ok: false, error: 'Invalid date.' };
    }
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'Invalid date.' };
  }

  return { ok: true, date };
}