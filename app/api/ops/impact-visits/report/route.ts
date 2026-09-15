// app/api/ops/impact-visits/report/route.ts
//
// GET ?year=2026 — store-master monthly comparison report: for every store
// (area-scoped exactly like the list route), one cell per month per visit
// type (virtual / on_location) summarising that month's submitted visit —
// whether the checklist/money/VM checks passed, and their scores. Only
// 'submitted' visits count; if more than one visit of the same type lands in
// the same month, the most recently submitted one wins.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { parseJson } from '@/lib/db/utils/impact-visits';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';

interface ReportCell {
  visitId: string;
  checklist: { pass: boolean; score: number; max: number };
  money: { ok: boolean };
  vm: { pass: boolean; score: number; max: number };
  // Per-question answers, so Ops can drill from the score down to exactly
  // which checklist items passed/failed each month.
  checklistResponses: ChecklistResponses;
  vmChecklistResponses: ChecklistResponses;
}

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const yearParam = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : new Date().getFullYear();

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const conditions = [
    eq(impactVisits.status, 'submitted'),
    gte(impactVisits.visitDate, yearStart),
    lte(impactVisits.visitDate, yearEnd),
  ];
  if (scope.scope === 'area') {
    conditions.push(eq(stores.areaId, scope.areaId));
  }

  const rows = await db
    .select({
      visit: impactVisits,
      storeName: stores.name,
      storeNo: stores.storeNo,
      areaName: areas.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(and(...conditions))
    // Ascending by updatedAt so that, as we fold rows into the per-month
    // slot below, the last write for a given (store, month, type) is simply
    // whichever row came last — no separate "most recent" comparison needed.
    .orderBy(impactVisits.updatedAt);

  type StoreEntry = {
    storeId: string;
    storeName: string;
    storeNo: string;
    areaName: string | null;
    months: Record<number, { virtual: ReportCell | null; onLocation: ReportCell | null }>;
  };

  const byStore = new Map<number, StoreEntry>();

  for (const row of rows) {
    const v = row.visit;
    if (!v.visitType) continue; // pre-dates the virtual/on_location split

    let entry = byStore.get(v.storeId);
    if (!entry) {
      entry = {
        storeId: String(v.storeId),
        storeName: row.storeName,
        storeNo: row.storeNo,
        areaName: row.areaName,
        months: {},
      };
      byStore.set(v.storeId, entry);
    }

    const month = v.visitDate.getUTCMonth() + 1;
    if (!entry.months[month]) {
      entry.months[month] = { virtual: null, onLocation: null };
    }

    const cell: ReportCell = {
      visitId: String(v.id),
      checklist: { pass: v.checklistGrade === 'A', score: v.checklistScore, max: v.checklistMaxScore },
      money: { ok: v.cashMoneyOk },
      vm: { pass: v.vmChecklistGrade === 'A', score: v.vmChecklistScore, max: v.vmChecklistMaxScore },
      checklistResponses: parseJson<ChecklistResponses>(v.checklistResponses, {}),
      vmChecklistResponses: parseJson<ChecklistResponses>(v.vmChecklistResponses, {}),
    };

    // Rows are processed oldest-updatedAt-first, so simply overwriting here
    // means the most recently submitted visit of this type wins.
    const slot = v.visitType === 'virtual' ? 'virtual' : 'onLocation';
    entry.months[month][slot] = cell;
  }

  return NextResponse.json({
    success: true,
    isHO: scope.scope === 'all_areas',
    year,
    stores: [...byStore.values()].sort((a, b) => a.storeName.localeCompare(b.storeName)),
  });
}
