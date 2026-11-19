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
//
// The store list also gets `history`: every visited month of every store in scope from its first visit up to the
// end of `year` (scores only, same "latest of the month wins" rule) — the list's all-time average.

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
  ReportVisitType,
  ScoreMonth,
  StoreReportRow,
} from '@/lib/impact-visit/report';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';
import { jakartaDateKey, jakartaDayStart } from '@/lib/day-bucket';
import { getHiddenStores, notHiddenStore } from '@/lib/db/utils/it-only-stores';

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

  // IT-only test stores (DUMMY…) are hidden from OPS HO (IT sees them).
  const inScope: SQL | undefined = scope.scope === 'area'
    ? eq(stores.areaId, scope.areaId)
    : notHiddenStore(stores.id, (await getHiddenStores()).storeIds);
  const oneStore: SQL | undefined = storeId != null ? eq(stores.id, storeId) : undefined;

  const [rows, storeRows, historyRows] = await Promise.all([
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
    // Scores of every visit up to the end of the year (the store list's "Sepanjang waktu" average).
    withAnswers
      ? Promise.resolve([])
      : db
          .select({
            storeId: impactVisits.storeId,
            visitType: impactVisits.visitType,
            visitDate: impactVisits.visitDate,
            checklistScore: impactVisits.checklistScore,
            checklistMaxScore: impactVisits.checklistMaxScore,
            checklistGrade: impactVisits.checklistGrade,
            vmChecklistScore: impactVisits.vmChecklistScore,
            vmChecklistMaxScore: impactVisits.vmChecklistMaxScore,
            vmChecklistGrade: impactVisits.vmChecklistGrade,
          })
          .from(impactVisits)
          .innerJoin(stores, eq(impactVisits.storeId, stores.id))
          .where(and(eq(impactVisits.status, 'submitted'), lt(impactVisits.visitDate, yearEnd), inScope))
          .orderBy(impactVisits.updatedAt, impactVisits.id),
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

  // store → type → YYYY-MM → that month's latest visit (rows come oldest-updatedAt first, so the last write wins).
  const historyMap = new Map<number, Record<ReportVisitType, Map<string, ScoreMonth>>>();
  for (const h of historyRows) {
    if (!h.visitType) continue;
    const slot: ReportVisitType = h.visitType === 'virtual' ? 'virtual' : 'onLocation';
    const ym = jakartaDateKey(h.visitDate).slice(0, 7);
    const entry = historyMap.get(h.storeId) ?? { virtual: new Map(), onLocation: new Map() };
    entry[slot].set(ym, {
      ym,
      checklist: { score: h.checklistScore, max: h.checklistMaxScore, pass: h.checklistGrade === 'A' },
      vm: { score: h.vmChecklistScore, max: h.vmChecklistMaxScore, pass: h.vmChecklistGrade === 'A' },
    });
    historyMap.set(h.storeId, entry);
  }
  const sortedMonths = (m: Map<string, ScoreMonth>) => [...m.values()].sort((a, b) => a.ym.localeCompare(b.ym));

  const body: ImpactReportResponse<ReportCellSummary | ReportCell> = {
    success: true,
    isHO: scope.scope === 'all_areas',
    year,
    groups: [...groupMap.values()],
    stores: [...byStore.values()].sort((a, b) => a.storeName.localeCompare(b.storeName)),
    ...(withAnswers
      ? {}
      : {
          history: Object.fromEntries(
            [...historyMap].map(([id, e]) => [
              String(id),
              { virtual: sortedMonths(e.virtual), onLocation: sortedMonths(e.onLocation) },
            ]),
          ),
        }),
  };

  return NextResponse.json(body);
}
