// app/api/ops/schedules/_helpers.ts
import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { loadOpsActor } from '@/lib/auth/ops-actor';

export interface OpsActor {
  id: string;
  role: string | null;
  employeeType: string | null;
  areaId: number | null;
  isHO: boolean;
}

/**
 * OPS schedule access — IT (all stores), OPS HO (all stores) or OPS Area (own area).
 * Single implementation in lib/auth/ops-actor.ts; requires an ACTIVE user with role
 * "ops" or "it" (the old copy here trusted employeeType alone and ignored isActive).
 */
export async function getOpsActor(userId: string): Promise<OpsActor | null> {
  const actor = await loadOpsActor(userId);
  if (!actor) return null;
  return {
    id: actor.id,
    role: actor.role,
    employeeType: actor.employeeType,
    areaId: actor.areaId,
    isHO: actor.isHO,
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
        storeNo: stores.storeNo,
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
      storeNo: stores.storeNo,
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
