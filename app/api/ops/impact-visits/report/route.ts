// app/api/ops/impact-visits/report/route.ts
//
// GET ?year=2026[&storeId=N] — the Impact Visit Monthly Report (area-scoped exactly like the list route).
//
//   no storeId  every store in scope × 12 months × visit type (virtual / on_location): a summary of that month's
//               submitted visit — Impact Visit checklist + VM Checklist score and grade, cash check, number of
//               "tidak" findings — for the store list (/ops/impact-visits/report)
//   storeId=N   the same for that one store, each cell WITH its per-item answers, for the store page
//               (/ops/impact-visits/report/[storeId]); a store outside the caller's scope answers 404
//
// `groups` is every store in scope by area (active stores, plus any other store that has a visit that year) — the
// store picker, and the rows of the stores nobody visited. Only 'submitted' visits count; when more than one visit
// of the same type lands in the same month, the most recently submitted one wins.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lt, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas, users } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { parseJson } from '@/lib/db/utils/impact-visits';
import type {
  ImpactReportResponse,
  ReportAreaGroup,
  ReportCell,
  ReportCellSummary,
  StoreReportRow,
} from '@/lib/impact-visit/report';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';
import { jakartaDateKey, jakartaDayStart } from '@/lib/day-bucket';

const countTidak = (r: ChecklistResponses) => Object.values(r).filter((x) => x?.answer === 'tidak').length;

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const yearParam = Number(req.nextUrl.searchParams.get('year'));
  const year =
    Number.isInteger(yearParam) && yearParam > 2000 && yearParam < 2200
      ? yearParam
      : Number(jakartaDateKey(new Date()).slice(0, 4));

  const storeParam = req.nextUrl.searchParams.get('storeId');
  const storeId = storeParam != null ? Number(storeParam) : null;
  if (storeId != null && (!Number.isInteger(storeId) || storeId <= 0)) {
    return NextResponse.json({ success: false, error: 'Invalid store.' }, { status: 400 });
  }
  const withAnswers = storeId != null;

  const yearStart = jakartaDayStart(`${year}-01-01`);
  const yearEnd = jakartaDayStart(`${year + 1}-01-01`);

  const inScope: SQL | undefined = scope.scope === 'area' ? eq(stores.areaId, scope.areaId) : undefined;
  const oneStore: SQL | undefined = storeId != null ? eq(stores.id, storeId) : undefined;

  const [rows, storeRows] = await Promise.all([
    db
      .select({
        visit: impactVisits,
        storeName: stores.name,
        storeNo: stores.storeNo,
        areaId: areas.id,
        areaName: areas.name,
        visitorName: users.name,
      })
      .from(impactVisits)
      .innerJoin(stores, eq(impactVisits.storeId, stores.id))
      .leftJoin(areas, eq(stores.areaId, areas.id))
      .leftJoin(users, eq(users.id, impactVisits.visitedBy))
      .where(
        and(
          eq(impactVisits.status, 'submitted'),
          gte(impactVisits.visitDate, yearStart),
          lt(impactVisits.visitDate, yearEnd),
          inScope,
          oneStore,
        ),
      )
      // Ascending by updatedAt so that, as we fold rows into the per-month slot below, the last write for a given
      // (store, month, type) is simply whichever row came last — no separate "most recent" comparison needed.
      .orderBy(impactVisits.updatedAt, impactVisits.id),
    db
      .select({
        id: stores.id,
        storeNo: stores.storeNo,
        name: stores.name,
        status: stores.status,
        areaId: areas.id,
        areaName: areas.name,
      })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      // Not narrowed to `storeId`: the one-store page's picker lists every store in scope.
      .where(inScope)
      .orderBy(areas.name, stores.name),
  ]);

  if (storeId != null && !storeRows.some((s) => s.id === storeId)) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  const byStore = new Map<number, StoreReportRow<ReportCellSummary | ReportCell>>();

  for (const row of rows) {
    const v = row.visit;
    if (!v.visitType) continue; // pre-dates the virtual/on_location split

    let entry = byStore.get(v.storeId);
    if (!entry) {
      entry = {
        storeId: String(v.storeId),
        storeName: row.storeName,
        storeNo: row.storeNo,
        areaId: row.areaId,
        areaName: row.areaName,
        months: {},
      };
      byStore.set(v.storeId, entry);
    }

    const month = String(Number(jakartaDateKey(v.visitDate).slice(5, 7)));
    if (!entry.months[month]) {
      entry.months[month] = { virtual: null, onLocation: null };
    }

    const checklistResponses = parseJson<ChecklistResponses>(v.checklistResponses, {});
    const vmChecklistResponses = parseJson<ChecklistResponses>(v.vmChecklistResponses, {});

    const summary: ReportCellSummary = {
      visitId: String(v.id),
      visitDate: v.visitDate.toISOString(),
      visitorName: row.visitorName,
      checklist: { pass: v.checklistGrade === 'A', score: v.checklistScore, max: v.checklistMaxScore },
      money: { ok: v.cashMoneyOk },
      vm: { pass: v.vmChecklistGrade === 'A', score: v.vmChecklistScore, max: v.vmChecklistMaxScore },
      findings: { checklist: countTidak(checklistResponses), vm: countTidak(vmChecklistResponses) },
    };
    const cell: ReportCellSummary | ReportCell = withAnswers
      ? { ...summary, checklistResponses, vmChecklistResponses }
      : summary;

    // Rows are processed oldest-updatedAt-first, so simply overwriting here
    // means the most recently submitted visit of this type wins.
    const slot = v.visitType === 'virtual' ? 'virtual' : 'onLocation';
    entry.months[month][slot] = cell;
  }

  // Every active store in scope, plus any other (closed / not open yet) that has a visit this year.
  const groupMap = new Map<number, ReportAreaGroup>();
  for (const s of storeRows) {
    if (s.status !== 'active' && !byStore.has(s.id)) continue;
    const g = groupMap.get(s.areaId) ?? { id: s.areaId, name: s.areaName, stores: [] };
    g.stores.push({ id: s.id, storeNo: s.storeNo, name: s.name });
    groupMap.set(s.areaId, g);
  }

  const body: ImpactReportResponse<ReportCellSummary | ReportCell> = {
    success: true,
    isHO: scope.scope === 'all_areas',
    year,
    groups: [...groupMap.values()],
    stores: [...byStore.values()].sort((a, b) => a.storeName.localeCompare(b.storeName)),
  };

  return NextResponse.json(body);
}
