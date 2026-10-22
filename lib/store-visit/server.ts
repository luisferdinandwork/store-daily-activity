import { and, desc, eq, inArray, isNull, min } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { guardApi } from '@/lib/auth/guards';
import { loadOpsActor } from '@/lib/auth/ops-actor';
import type { OpsActorRecord } from '@/lib/auth/ops-actor';
import { db } from '@/lib/db';
import { addDaysKey, jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';
import { areas, employeeTypes, stores, storeVisitConfig, storeVisitPolicies, storeVisits, userRoles, users } from '@/lib/db/schema';
import { OPS_ACTIVITY_DAYS, buildReportStore, calendarWeeks, type ReportOps, type VisitReport } from './report';
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

/**
 * Data for the Ops "Report Visit" page: every active store in scope with its current
 * visit cycle and how its finished cycles went, plus what each Ops did lately.
 * Ops Area sees only its own submissions within its assigned area. HO / IT see all.
 */
export async function visitReport(actor: OpsActorRecord, month?: string): Promise<VisitReport> {
  if (!actor.isHO && actor.areaId == null) throw new Error('Ops area is required.');
  const areaId = actor.isHO ? null : actor.areaId;
  const visitorScope = actor.isHO ? undefined : eq(storeVisits.visitedBy, actor.id);
  const today = jakartaTodayKey();
  const calendarMonth = month ?? today.slice(0, 7);
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
    db.select({ id: users.id, name: users.name, areaId: users.areaId, areaName: areas.name }).from(users)
      .innerJoin(userRoles, eq(users.roleId, userRoles.id))
      .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .leftJoin(areas, eq(areas.id, users.areaId))
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

  // What each Ops did in the last OPS_ACTIVITY_DAYS days — assigned Ops Area users with no
  // visit at all still get a row (that is the point), plus anyone else who visited.
  const since = addDaysKey(today, 1 - OPS_ACTIVITY_DAYS);
  const activity = new Map<string, ReportOps>(opsRows.map((o) => [o.id, { id: o.id, name: o.name, areaName: o.areaName, visits: 0, stores: 0, lastVisitAt: null }]));
  const storesSeen = new Map<string, Set<number>>();
  for (const v of visitRows) {
    const day = jakartaDateKey(v.at);
    if (day < since || day > today) continue;
    const entry = activity.get(v.byId) ?? { id: v.byId, name: v.by ?? 'Ops', areaName: null, visits: 0, stores: 0, lastVisitAt: null };
    entry.visits++;
    const seen = storesSeen.get(v.byId) ?? new Set<number>();
    seen.add(v.storeId); storesSeen.set(v.byId, seen);
    entry.stores = seen.size;
    const at = v.at.toISOString();
    if (!entry.lastVisitAt || at > entry.lastVisitAt) entry.lastVisitAt = at;
    activity.set(v.byId, entry);
  }

  const areaList = new Map<number, string>();
  for (const s of reportStores) areaList.set(s.areaId, s.areaName);

  // The calendar's weeks run Monday–Sunday, so they spill into the months around it.
  const weeks = calendarWeeks(calendarMonth);
  const calFrom = weeks[0][0];
  const calTo = weeks[weeks.length - 1][6];
  const calendarVisits = visitRows
    .map((v) => ({ id: v.id, storeId: v.storeId, at: v.at.toISOString(), day: jakartaDateKey(v.at), byId: v.byId, by: v.by }))
    .filter((v) => v.day >= calFrom && v.day <= calTo)
    .sort((a, b) => a.at.localeCompare(b.at));

  return {
    today,
    trackedFrom,
    activityDays: OPS_ACTIVITY_DAYS,
    month: calendarMonth,
    calendarVisits,
    areas: [...areaList.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    stores: reportStores,
    ops: [...activity.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)),
  };
}

export async function visitHistory(storeId: number, actor: OpsActorRecord) {
  const rows = await db.select({ visit: storeVisits, visitorName: users.name }).from(storeVisits)
    .leftJoin(users, eq(users.id, storeVisits.visitedBy))
    .where(and(eq(storeVisits.storeId, storeId), actor.isHO ? undefined : eq(storeVisits.visitedBy, actor.id)))
    .orderBy(desc(storeVisits.visitedAt)).limit(30);
  return rows.map(({ visit, visitorName }) => ({ ...visit, visitedAt: visit.visitedAt.toISOString(), visitorName }));
}
