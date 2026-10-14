import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { guardApi } from '@/lib/auth/guards';
import { loadOpsActor } from '@/lib/auth/ops-actor';
import { db } from '@/lib/db';
import { areas, stores, storeVisitConfig, storeVisitPolicies, storeVisits, users } from '@/lib/db/schema';
import { visitProgress } from './rules';
import type { VisitStore } from './types';

export async function visitActor() {
  const guard = await guardApi(['ops', 'it']);
  if (!guard.ok) return guard;
  const actor = await loadOpsActor(guard.user.id);
  if (!actor || (!actor.isHO && actor.areaId == null)) return { ok: false as const, response: NextResponse.json({ success: false, error: 'Area Ops belum ditentukan.' }, { status: 403 }) };
  return { ok: true as const, actor, canSubmit: actor.isOpsArea || actor.role === 'it' };
}

export async function visitConfiguration() {
  const [config] = await db.select().from(storeVisitConfig).where(eq(storeVisitConfig.id, 1));
  if (!config) throw new Error('Store visit configuration has not been migrated.');
  return config;
}

export async function visitStores(areaId: number | null) {
  const rows = await db.select({
    id: stores.id, storeNo: stores.storeNo, name: stores.name,
    areaName: areas.name, lat: stores.latitude, lng: stores.longitude,
    policy: storeVisitPolicies,
  }).from(stores).innerJoin(areas, eq(areas.id, stores.areaId))
    .leftJoin(storeVisitPolicies, eq(storeVisitPolicies.storeNo, stores.storeNo))
    .where(and(eq(stores.status, 'active'), areaId == null ? undefined : eq(stores.areaId, areaId)))
    .orderBy(stores.name);
  const dates = await db.select({ storeId: storeVisits.storeId, visitedAt: storeVisits.visitedAt })
    .from(storeVisits).innerJoin(stores, eq(stores.id, storeVisits.storeId))
    .where(and(eq(stores.status, 'active'), areaId == null ? undefined : eq(stores.areaId, areaId)))
    .orderBy(desc(storeVisits.visitedAt));
  const byStore = new Map<number, Date[]>();
  for (const row of dates) {
    const list = byStore.get(row.storeId) ?? [];
    list.push(row.visitedAt); byStore.set(row.storeId, list);
  }
  return rows.map((r): VisitStore => ({
    id: r.id, storeNo: r.storeNo, name: r.name, areaName: r.areaName,
    hasCoordinates: r.lat !== null && r.lng !== null,
    policy: r.policy, progress: visitProgress(r.policy, byStore.get(r.id) ?? []),
  }));
}

export async function visitHistory(storeId: number) {
  const rows = await db.select({ visit: storeVisits, visitorName: users.name }).from(storeVisits)
    .leftJoin(users, eq(users.id, storeVisits.visitedBy))
    .where(eq(storeVisits.storeId, storeId)).orderBy(desc(storeVisits.visitedAt)).limit(30);
  return rows.map(({ visit, visitorName }) => ({ ...visit, visitedAt: visit.visitedAt.toISOString(), visitorName }));
}
