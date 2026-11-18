// lib/impact-visit/report.ts
//
// Shapes + pure view logic for the Impact Visit Monthly Report (client-safe):
//
//   /ops/impact-visits/report             every store × the 12 months of a year — the Impact Visit checklist
//                                         score and the VM Checklist score of each month's visit, side by side
//   /ops/impact-visits/report/[storeId]   one store: the 12-month score strip + the item-by-item comparison
//
// API: GET /api/ops/impact-visits/report?year=YYYY[&storeId=N]. Without a store the cells are summaries (no
// per-item answers — 50 stores × 24 cells of answers would be megabytes); with one they carry the answers too.
// Only submitted visits count; when a month has more than one visit of the same type, the latest one wins.

import type { ChecklistResponses } from './scoring';

export type ReportVisitType = 'onLocation' | 'virtual';

/** One month's visit of one type, without the per-item answers. */
export interface ReportCellSummary {
  visitId: string;
  visitDate: string;
  visitorName: string | null;
  checklist: { pass: boolean; score: number; max: number };
  money: { ok: boolean };
  vm: { pass: boolean; score: number; max: number };
  /** Items answered "tidak" in each checklist. */
  findings: { checklist: number; vm: number };
}

/** The same with every answer — only for the one-store page. */
export interface ReportCell extends ReportCellSummary {
  checklistResponses: ChecklistResponses;
  vmChecklistResponses: ChecklistResponses;
}

export type ReportMonths<C> = Record<string, { virtual: C | null; onLocation: C | null }>;

export interface StoreReportRow<C extends ReportCellSummary = ReportCell> {
  storeId: string;
  storeName: string;
  storeNo: string;
  areaId: number | null;
  areaName: string | null;
  /** Keyed "1".."12". */
  months: ReportMonths<C>;
}

export interface ReportStoreOption {
  id: number;
  storeNo: string;
  name: string;
}

export interface ReportAreaGroup {
  id: number;
  name: string;
  stores: ReportStoreOption[];
}

export interface ImpactReportResponse<C extends ReportCellSummary = ReportCellSummary> {
  success: true;
  isHO: boolean;
  year: number;
  /** Every store in scope, by area — the store picker and the rows of stores without a visit. */
  groups: ReportAreaGroup[];
  /** Stores with at least one submitted visit in the year. */
  stores: StoreReportRow<C>[];
}

export const REPORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const isReportVisitType = (v: unknown): v is ReportVisitType => v === 'onLocation' || v === 'virtual';

/** The store list for a year + visit type (where the store page's "back" goes). */
export const reportListHref = (year: number, type: ReportVisitType) =>
  `/ops/impact-visits/report?year=${year}&type=${type}`;

/** One store's page for a year + visit type. */
export const storeReportHref = (storeId: number | string, year: number, type: ReportVisitType) =>
  `/ops/impact-visits/report/${storeId}?year=${year}&type=${type}`;

/** `?year=` as a sane year, else this year in Jakarta (`thisYear`). */
export function parseReportYear(raw: string | string[] | undefined, thisYear: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 2000 && n < 2200 ? n : thisYear;
}

/** `?type=` as a visit type, else On Location. */
export function parseReportType(raw: string | string[] | undefined): ReportVisitType {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isReportVisitType(v) ? v : 'onLocation';
}

/** The 12 cells of one visit type, Jan → Dec (null = no visit that month). */
export function monthCells<C extends ReportCellSummary>(
  row: StoreReportRow<C> | undefined,
  type: ReportVisitType,
): (C | null)[] {
  return REPORT_MONTHS.map((_, i) => row?.months[String(i + 1)]?.[type] ?? null);
}

// ─── The store list ──────────────────────────────────────────────────────────

export type ScoreKind = 'checklist' | 'vm';

/** A score as a share of its maximum, 0–100 (the two checklists have different maxima: 100 and 70). */
export const scorePct = (s: { score: number; max: number }): number =>
  s.max > 0 ? Math.round((s.score / s.max) * 100) : 0;

export interface YearSummary {
  /** Months with a visit of the type. */
  visited: number;
  /** Average score of the visited months, per checklist (raw points, one decimal); null = no visit. */
  avg: Record<ScoreKind, number | null>;
  /** Average as % of the maximum, for sorting / colouring. */
  avgPct: Record<ScoreKind, number | null>;
  /** Months that passed (grade A), per checklist. */
  passed: Record<ScoreKind, number>;
  /** The latest visited month's cell. */
  latest: ReportCellSummary | null;
  /** Change of the latest score against the visit before it (raw points); null = fewer than two visits. */
  trend: Record<ScoreKind, number | null>;
}

export function yearSummary(cells: (ReportCellSummary | null)[]): YearSummary {
  const visited = cells.filter((c): c is ReportCellSummary => c != null);
  const avgOf = (k: ScoreKind) =>
    visited.length ? Math.round((visited.reduce((s, c) => s + c[k].score, 0) / visited.length) * 10) / 10 : null;
  const avgPctOf = (k: ScoreKind) =>
    visited.length ? Math.round(visited.reduce((s, c) => s + scorePct(c[k]), 0) / visited.length) : null;
  const latest = visited.at(-1) ?? null;
  const before = visited.at(-2) ?? null;
  const trendOf = (k: ScoreKind) => (latest && before ? latest[k].score - before[k].score : null);

  return {
    visited: visited.length,
    avg: { checklist: avgOf('checklist'), vm: avgOf('vm') },
    avgPct: { checklist: avgPctOf('checklist'), vm: avgPctOf('vm') },
    passed: {
      checklist: visited.filter((c) => c.checklist.pass).length,
      vm: visited.filter((c) => c.vm.pass).length,
    },
    latest,
    trend: { checklist: trendOf('checklist'), vm: trendOf('vm') },
  };
}

export interface ReportListRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number;
  areaName: string;
  cells: (ReportCellSummary | null)[];
  summary: YearSummary;
}

/** Every store in scope as a list row — stores with no visit in the year included (empty cells). */
export function buildListRows(
  groups: ReportAreaGroup[],
  reports: StoreReportRow<ReportCellSummary>[],
  type: ReportVisitType,
): ReportListRow[] {
  const byId = new Map(reports.map((r) => [r.storeId, r]));
  return groups.flatMap((g) =>
    g.stores.map((s) => {
      const cells = monthCells(byId.get(String(s.id)), type);
      return {
        storeId: s.id,
        storeNo: s.storeNo,
        storeName: s.name,
        areaId: g.id,
        areaName: g.name,
        cells,
        summary: yearSummary(cells),
      };
    }),
  );
}

export type ReportSortKey = 'store' | 'avg_checklist' | 'avg_vm' | 'latest_checklist' | 'latest_vm' | 'visited';

export const REPORT_SORT_OPTIONS: { key: ReportSortKey; label: string }[] = [
  { key: 'store', label: 'Nama toko' },
  { key: 'avg_checklist', label: 'Rata-rata Impact Visit' },
  { key: 'avg_vm', label: 'Rata-rata VM' },
  { key: 'latest_checklist', label: 'Impact Visit terakhir' },
  { key: 'latest_vm', label: 'VM terakhir' },
  { key: 'visited', label: 'Bulan terisi' },
];

/** Names A→Z; scores lowest first (the stores that need help on top); months visited most first. */
export const defaultReportSortDir = (key: ReportSortKey): 'asc' | 'desc' => (key === 'visited' ? 'desc' : 'asc');

const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

/** Stores without a score always sink to the bottom, whichever way the scores are sorted. */
export function sortReportRows(rows: ReportListRow[], key: ReportSortKey, dir: 'asc' | 'desc'): ReportListRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: ReportListRow): number | null => {
    switch (key) {
      case 'avg_checklist':
        return r.summary.avgPct.checklist;
      case 'avg_vm':
        return r.summary.avgPct.vm;
      case 'latest_checklist':
        return r.summary.latest ? scorePct(r.summary.latest.checklist) : null;
      case 'latest_vm':
        return r.summary.latest ? scorePct(r.summary.latest.vm) : null;
      case 'visited':
        return r.summary.visited;
      default:
        return null;
    }
  };
  const byName = (a: ReportListRow, b: ReportListRow) => collator.compare(a.storeName, b.storeName);

  return [...rows].sort((a, b) => {
    if (key === 'store') return sign * byName(a, b);
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return byName(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va - vb) || byName(a, b);
  });
}

export interface ReportTotals {
  stores: number;
  /** Stores with at least one visit of the type in the year. */
  visitedStores: number;
  visits: number;
  /** Average over every visit (not over stores), raw points; null = no visit. */
  avg: Record<ScoreKind, number | null>;
  /** Share of visits that passed, %; null = no visit. */
  passRate: Record<ScoreKind, number | null>;
}

export function reportTotals(rows: ReportListRow[]): ReportTotals {
  const cells = rows.flatMap((r) => r.cells.filter((c): c is ReportCellSummary => c != null));
  const avg = (k: ScoreKind) =>
    cells.length ? Math.round((cells.reduce((s, c) => s + c[k].score, 0) / cells.length) * 10) / 10 : null;
  const pass = (k: ScoreKind) =>
    cells.length ? Math.round((cells.filter((c) => c[k].pass).length / cells.length) * 100) : null;
  return {
    stores: rows.length,
    visitedStores: rows.filter((r) => r.summary.visited > 0).length,
    visits: cells.length,
    avg: { checklist: avg('checklist'), vm: avg('vm') },
    passRate: { checklist: pass('checklist'), vm: pass('vm') },
  };
}
