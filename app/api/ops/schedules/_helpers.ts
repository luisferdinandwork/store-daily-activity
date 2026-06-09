// app/api/ops/schedules/_helpers.ts
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  areas,
  stores,
  users,
  userRoles,
  employeeTypes,
} from '@/lib/db/schema';

export interface OpsActor {
  id: string;
  role: string | null;
  employeeType: string | null;
  areaId: number | null;
  isHO: boolean;
}

/**
 * OPS schedule access:
 * - admin role: all stores
 * - ops role: allowed
 * - employeeType ops_ho: all stores
 * - employeeType ops_area: stores inside their area only
 *
 * This intentionally does not require role === "ops" because your app stores
 * OPS access mainly through employeeType in several places.
 */
export async function getOpsActor(userId: string): Promise<OpsActor | null> {
  const [row] = await db
    .select({
      id: users.id,
      role: userRoles.code,
      areaId: users.areaId,
      employeeType: employeeTypes.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const isAdmin = row.role === 'admin';
  const isOpsRole = row.role === 'ops';
  const isOpsArea = row.employeeType === 'ops_area';
  const isOpsHO = row.employeeType === 'ops_ho';

  if (!isAdmin && !isOpsRole && !isOpsArea && !isOpsHO) return null;

  return {
    id: row.id,
    role: row.role ?? null,
    employeeType: row.employeeType ?? null,
    areaId: row.areaId ?? null,
    isHO: isAdmin || isOpsHO,
  };
}

export async function assertStoreInActorArea(
  actor: OpsActor,
  storeId: number,
): Promise<string | null> {
  const [store] = await db
    .select({
      id: stores.id,
      areaId: stores.areaId,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Store not found.';
  if (actor.isHO) return null;

  if (!actor.areaId) return 'OPS user has no area assigned.';
  if (store.areaId !== actor.areaId) return 'This store is not in your area.';

  return null;
}

export function parseStoreId(
  raw: string | number | null | undefined,
): { ok: true; id: number } | { ok: false; error: string } {
  if (raw == null || raw === '') {
    return { ok: false, error: 'storeId required.' };
  }

  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: 'Invalid storeId.' };
  }

  return { ok: true, id };
}

export function parseLocalDate(value: string): Date | null {
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeShiftCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function listStoresForActor(actor: OpsActor) {
  if (actor.isHO) {
    return db
      .select({
        id: stores.id,
        name: stores.name,
        address: stores.address,
        areaId: stores.areaId,
        areaName: areas.name,
      })
      .from(stores)
      .leftJoin(areas, eq(areas.id, stores.areaId))
      .orderBy(asc(areas.name), asc(stores.name));
  }

  if (!actor.areaId) return [];

  return db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      areaId: stores.areaId,
      areaName: areas.name,
    })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(eq(stores.areaId, actor.areaId))
    .orderBy(asc(stores.name));
}

export async function listAreasForActor(actor: OpsActor) {
  if (actor.isHO) {
    return db
      .select({
        id: areas.id,
        name: areas.name,
      })
      .from(areas)
      .orderBy(asc(areas.name));
  }

  if (!actor.areaId) return [];

  return db
    .select({
      id: areas.id,
      name: areas.name,
    })
    .from(areas)
    .where(eq(areas.id, actor.areaId))
    .limit(1);
}
