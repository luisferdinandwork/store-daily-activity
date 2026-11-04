import { and, desc, eq, inArray, isNull, min } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { guardApi } from '@/lib/auth/guards';
import { loadOpsActor } from '@/lib/auth/ops-actor';
import type { OpsActorRecord } from '@/lib/auth/ops-actor';
import { db } from '@/lib/db';
import { jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { areas, employeeTypes, stores, storeVisitConfig, storeVisitPolicies, storeVisits, userRoles, users } from '@/lib/db/schema';
import { buildReportStore, calendarWeeks, type VisitReport, type VisitUpcoming } from './report';
import { visitProgress } from './rules';
import type { VisitResult, VisitStore } from './types';

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
    areaId: stores.areaId, areaName: areas.name, lat: stores.latitude, lng: stores.longitude,
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
    id: r.id, storeNo: r.storeNo, name: r.name, areaId: r.areaId, areaName: r.areaName,
    hasCoordinates: r.lat !== null && r.lng !== null,
    policy: r.policy, progress: visitProgress(r.policy, byStore.get(r.id) ?? []),
  }));
}

/**
 * The stores in the actor's scope with their current visit cycle and how their finished
 * cycles went — the one read behind the Report and the Upcoming pages.
 * Ops Area sees only its own submissions within its assigned area. HO / IT see all.
 */
async function loadVisitScope(actor: OpsActorRecord) {
  if (!actor.isHO && actor.areaId == null) throw new Error('Ops area is required.');
  const areaId = actor.isHO ? null : actor.areaId;
  const visitorScope = actor.isHO ? undefined : eq(storeVisits.visitedBy, actor.id);
  const today = jakartaTodayKey();
  const scope = and(eq(stores.status, 'active'), areaId == null ? undefined : eq(stores.areaId, areaId));

  const rows = await db.select({
    id: stores.id, storeNo: stores.storeNo, name: stores.name,
    areaId: stores.areaId, areaName: areas.name, policy: storeVisitPolicies,
  }).from(stores).innerJoin(areas, eq(areas.id, stores.areaId))
    .leftJoin(storeVisitPolicies, eq(storeVisitPolicies.storeNo, stores.storeNo))
    .where(scope).orderBy(stores.name);
  const storeIds = rows.map((r) => r.id);

  const [visitRows, [policyBound], [visitBound], opsRows] = await Promise.all([
    storeIds.length
      ? db.select({ id: storeVisits.id, storeId: storeVisits.storeId, at: storeVisits.visitedAt, byId: storeVisits.visitedBy, by: users.name })
          .from(storeVisits).leftJoin(users, eq(users.id, storeVisits.visitedBy))
          .where(and(inArray(storeVisits.storeId, storeIds), visitorScope)).orderBy(desc(storeVisits.visitedAt))
      : Promise.resolve([]),
    db.select({ at: min(storeVisitPolicies.updatedAt) }).from(storeVisitPolicies),
    db.select({ at: min(storeVisits.visitedAt) }).from(storeVisits)
      .innerJoin(stores, eq(stores.id, storeVisits.storeId)).where(and(scope, visitorScope)),
    db.select({ id: users.id, name: users.name, areaId: users.areaId }).from(users)
      .innerJoin(userRoles, eq(users.roleId, userRoles.id))
      .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .where(and(eq(userRoles.code, 'ops'), eq(employeeTypes.code, 'ops_area'), eq(users.isActive, true), isNull(users.deletedAt), areaId == null ? undefined : eq(users.areaId, areaId), actor.isHO ? undefined : eq(users.id, actor.id))),
  ]);

  // Visits are only judged from the day the programme began (the roster import or the
  // first visit, whichever came first) — earlier weeks aren't "missed", they predate it.
  const firstDays = [policyBound?.at, visitBound?.at].filter((d): d is Date => !!d).map((d) => jakartaDateKey(d));
  const trackedFrom = firstDays.length ? firstDays.sort()[0] : null;

  const opsByArea = new Map<number, string[]>();
  for (const o of opsRows) {
    if (o.areaId == null) continue;
    opsByArea.set(o.areaId, [...(opsByArea.get(o.areaId) ?? []), o.name]);
  }
  const visitsByStore = new Map<number, typeof visitRows>();
  for (const v of visitRows) visitsByStore.set(v.storeId, [...(visitsByStore.get(v.storeId) ?? []), v]);

  const reportStores = rows.map((r) => buildReportStore(
    { id: r.id, storeNo: r.storeNo, name: r.name, areaId: r.areaId!, areaName: r.areaName, opsNames: opsByArea.get(r.areaId!) ?? [], policy: r.policy },
    visitsByStore.get(r.id) ?? [],
    today,
    trackedFrom,
  ));

  const areaList = new Map<number, string>();
  for (const s of reportStores) areaList.set(s.areaId, s.areaName);

  return {
    scope: (actor.isHO ? 'all' : 'area') as 'area' | 'all',
    today,
    trackedFrom,
    visitRows,
    reportStores,
    areas: [...areaList.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Data for the Ops "Report Visit" page: every active store in scope with its finished
 * cycles (what was missed) and every visit made in the weeks the month's calendar shows.
 */
export async function visitReport(actor: OpsActorRecord, month?: string): Promise<VisitReport> {
  const s = await loadVisitScope(actor);
  const calendarMonth = month ?? s.today.slice(0, 7);

  // The calendar's weeks run Monday–Sunday, so they spill into the months around it.
  const weeks = calendarWeeks(calendarMonth);
  const calFrom = weeks[0][0];
  const calTo = weeks[weeks.length - 1][6];
  const calendarVisits = s.visitRows
    .map((v) => ({ id: v.id, storeId: v.storeId, at: v.at.toISOString(), day: jakartaDateKey(v.at), byId: v.byId, by: v.by }))
    .filter((v) => v.day >= calFrom && v.day <= calTo && v.day <= s.today)
    .sort((a, b) => a.at.localeCompare(b.at));

  return {
    scope: s.scope,
    today: s.today,
    trackedFrom: s.trackedFrom,
    month: calendarMonth,
    calendarVisits,
    areas: s.areas,
    stores: s.reportStores,
  };
}

/** Data for the Ops "Upcoming Visit" page: the stores in scope with their current cycle. */
export async function visitUpcoming(actor: OpsActorRecord): Promise<VisitUpcoming> {
  const s = await loadVisitScope(actor);
  return { scope: s.scope, today: s.today, areas: s.areas, stores: s.reportStores };
}

/**
 * One saved visit with everything Ops wrote (the Report's result preview). Same scope as
 * the Report: HO / IT any visit, Ops Area only their own visits inside their own area.
 */
export async function visitResult(visitId: string, actor: OpsActorRecord): Promise<VisitResult | null> {
  const [row] = await db.select({
    visit: storeVisits, visitorName: users.name,
    storeName: stores.name, storeNo: stores.storeNo, areaId: stores.areaId, areaName: areas.name,
  }).from(storeVisits)
    .innerJoin(stores, eq(stores.id, storeVisits.storeId))
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .leftJoin(users, eq(users.id, storeVisits.visitedBy))
    .where(eq(storeVisits.id, visitId));
  if (!row) return null;
  if (!actor.isHO && (row.areaId !== actor.areaId || row.visit.visitedBy !== actor.id)) return null;
  const { visit } = row;
  return {
    ...visit, visitedAt: visit.visitedAt.toISOString(), visitorName: row.visitorName,
    storeName: row.storeName, storeNo: row.storeNo, areaName: row.areaName,
  };
}
