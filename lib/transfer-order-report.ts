// lib/transfer-order-report.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure logic of the OPS TO Report (/ops/transfer-order/report/[process]): per
// store, how many processes of ONE kind it had in a period and how many it has
// finished. Client-safe (no DB, no React) so the rules are testable on their own.
//
// A transfer order gives stores up to THREE kinds of process:
//
//   return     Item Return    the ORIGIN store hands the goods to the courier.
//                             Starts: TO Dibuat.   Done: Foto Serah Terima.
//   receiving  Item Receiving the DESTINATION store takes the goods in.
//                             Listed from WS Diposting (that is when it shows on the
//                             store's app, and the day it is counted on), but the CLOCK
//                             only starts at Terima Fisik Barang di Toko (the store's
//                             photo) and it is done at WR Diposting (BC). Until the
//                             photo it is open with no time running.
//   delivery   Item Delivery  the courier's trip between two stores — counted for
//                             the DESTINATION store (the one waiting for it).
//                             Starts: Foto Serah Terima. Done: Terima Fisik di Toko.
//                             Store → store only: a DM warehouse has no employee
//                             to start the clock (its shipments are Item Receiving).
//
// What is recorded on each item (the timeline in the store sheet, `LegItem.steps`):
//
//   Item Return     TO Dibuat → WS Diposting → Foto Serah Terima
//   Item Receiving  Terima Fisik Barang di Toko → WR Diposting
//   Item Delivery   Foto Serah Terima → Terima Fisik Barang di Toko
//
// For Item Return and Item Delivery that is the same clock as above; for Item
// Receiving it is Terima Fisik → WR Diposting, i.e. the whole timeline.
//
// A DM warehouse end gives no process on that side. Days are Jakarta calendar
// days, and a process belongs to the day it STARTED (a cohort): "of what began
// this week, how much is done" — it doesn't drift when something finishes later.
// ─────────────────────────────────────────────────────────────────────────────

import { jakartaDateKey } from '@/lib/day-bucket';
import { effectiveToCreatedAt } from '@/lib/transfer-order-metrics';

export type Process = 'return' | 'receiving' | 'delivery';

export const PROCESSES: Process[] = ['return', 'receiving', 'delivery'];

export function isProcess(value: unknown): value is Process {
  return typeof value === 'string' && (PROCESSES as string[]).includes(value);
}

/** Words for one process — shared by the page, the sheet and the API's notes. */
export interface ProcessMeta {
  label: string;
  /** One line under the page title. */
  blurb: string;
  startLabel: string;
  doneLabel: string;
  waitingLabel: string;
  /** "Ke" / "Dari" — which way the other end of the transfer lies. */
  directionLabel: string;
  /** The average duration's name + its range, for the KPI tile. */
  avgLabel: string;
  rangeHint: string;
  /** What "Menunggu terlama" measures, for its KPI tile. */
  waitHint: string;
  /** How the process is counted, for the page footnote. */
  howItCounts: string;
}

export const PROCESS_META: Record<Process, ProcessMeta> = {
  return: {
    label: 'Item Return',
    blurb: 'Toko asal menyerahkan barang ke kurir',
    startLabel: 'TO Dibuat',
    doneLabel: 'Foto serah terima',
    waitingLabel: 'menunggu foto serah terima',
    directionLabel: 'Ke',
    avgLabel: 'Rata-rata Total Proses Item Return',
    rangeHint: 'TO Dibuat → Foto Serah Terima',
    waitHint: 'proses terbuka yang paling lama',
    howItCounts:
      'Satu proses per TO untuk toko asal, dihitung pada hari TO dibuat. Selesai saat toko asal mengirim foto serah terima ke kurir. ' +
      'TO dari gudang (DM) tidak punya Item Return.',
  },
  receiving: {
    label: 'Item Receiving',
    blurb: 'Toko tujuan menerima fisik barang, lalu WR diposting di Business Central',
    startLabel: 'Terima fisik di toko',
    doneLabel: 'WR Diposting',
    waitingLabel: 'menunggu WR diposting',
    directionLabel: 'Dari',
    avgLabel: 'Rata-rata Terima Fisik → WR Diposting',
    rangeHint: 'Terima Fisik Barang di Toko → WR Diposting',
    waitHint: 'sejak terima fisik, WR belum diposting',
    howItCounts:
      'Satu proses per TO untuk toko tujuan, dihitung pada hari WS diposting di Business Central (sejak itu TO muncul di aplikasi toko). ' +
      'Waktu baru dihitung setelah toko memfoto terima fisik barang, dan proses selesai saat WR diposting di Business Central. ' +
      'Sebelum ada foto, proses terbuka tanpa waktu berjalan. TO ke gudang (DM) tidak punya Item Receiving.',
  },
  delivery: {
    label: 'Item Delivery',
    blurb: 'Pengiriman kurir antar toko, dihitung untuk toko tujuan',
    startLabel: 'Foto serah terima',
    doneLabel: 'Terima fisik di toko',
    waitingLabel: 'menunggu terima fisik di toko',
    directionLabel: 'Dari',
    avgLabel: 'Rata-rata Waktu Pengiriman',
    rangeHint: 'Foto Serah Terima → Terima Fisik Barang di Toko',
    waitHint: 'proses terbuka yang paling lama',
    howItCounts:
      'Satu proses per TO antar toko untuk toko tujuan, dihitung pada hari toko asal mengirim foto serah terima. Selesai saat toko ' +
      'tujuan mengonfirmasi barang diterima secara fisik. Pengiriman dari/ke gudang (DM) tidak dihitung di sini (lihat Item Receiving).',
  },
};

/** The item_transfer_orders columns the report needs. */
export interface ReportRow {
  id: number;
  toaNo: string;
  transferFromCode: string;
  transferToCode: string;
  fromStoreId: number | null;
  toStoreId: number | null;
  qtyOrdered: number;
  whseShipmentNo: string | null;
  returnDetectedAt: Date | null;
  returnSubmittedAt: Date | null;
  droppingDetectedAt: Date | null;
  droppingSubmittedAt: Date | null;
  /** WR Diposting (first seen posted in BC). */
  receivedAt: Date | null;
}

/**
 * One moment on an item's timeline. `at` null = it hasn't happened yet. `signed`
 * = it may legitimately come BEFORE the step above it (the store photographed the
 * hand-off before BC posted the WS), so the gap can read negative.
 */
export interface LegStep {
  label: string;
  at: Date | null;
  signed?: boolean;
}

/** One process (one kind, of one TO) for one store. */
export interface LegItem {
  rowId: number;
  toaNo: string;
  process: Process;
  storeId: number;
  /** The other end: the destination (return) or the origin (receiving / delivery). */
  counterpartCode: string;
  qty: number;
  /** When it entered the report — the Jakarta day of this is its bucket (`day`). */
  anchorAt: Date;
  /** When its clock started. Null = not yet (an Item Receiving before the store's photo). */
  startedAt: Date | null;
  doneAt: Date | null;
  /** Jakarta day the process entered the report — its bucket. */
  day: string;
  /** What gets recorded for the item, in order (see the header of this file). */
  steps: LegStep[];
}

export function legsOf(row: ReportRow): LegItem[] {
  const out: LegItem[] = [];

  if (row.fromStoreId != null) {
    const startedAt = effectiveToCreatedAt(row.returnDetectedAt, row.droppingDetectedAt, row.returnSubmittedAt);
    if (startedAt) {
      out.push({
        rowId: row.id, toaNo: row.toaNo, process: 'return', storeId: row.fromStoreId,
        counterpartCode: row.transferToCode, qty: row.qtyOrdered,
        anchorAt: startedAt, startedAt, doneAt: row.returnSubmittedAt, day: jakartaDateKey(startedAt),
        // TO Dibuat → WS Diposting → Foto Serah Terima
        steps: [
          { label: 'TO Dibuat', at: startedAt },
          { label: 'WS Diposting', at: row.droppingDetectedAt },
          { label: 'Foto Serah Terima', at: row.returnSubmittedAt, signed: true },
        ],
      });
    }
  }

  if (row.toStoreId != null && row.whseShipmentNo && row.droppingDetectedAt) {
    out.push({
      rowId: row.id, toaNo: row.toaNo, process: 'receiving', storeId: row.toStoreId,
      counterpartCode: row.transferFromCode, qty: row.qtyOrdered,
      // Listed (and bucketed) from WS Diposting, timed from the store's photo, done at WR Diposting.
      anchorAt: row.droppingDetectedAt, startedAt: row.droppingSubmittedAt, doneAt: row.receivedAt,
      day: jakartaDateKey(row.droppingDetectedAt),
      // Terima Fisik Barang di Toko → WR Diposting
      steps: [
        { label: 'Terima Fisik Barang di Toko', at: row.droppingSubmittedAt },
        { label: 'WR Diposting', at: row.receivedAt },
      ],
    });
  }

  // Store → store, once the origin has handed the goods over.
  if (row.toStoreId != null && row.fromStoreId != null && row.returnSubmittedAt) {
    out.push({
      rowId: row.id, toaNo: row.toaNo, process: 'delivery', storeId: row.toStoreId,
      counterpartCode: row.transferFromCode, qty: row.qtyOrdered,
      anchorAt: row.returnSubmittedAt, startedAt: row.returnSubmittedAt, doneAt: row.droppingSubmittedAt,
      day: jakartaDateKey(row.returnSubmittedAt),
      steps: [
        { label: 'Foto Serah Terima', at: row.returnSubmittedAt },
        { label: 'Terima Fisik Barang di Toko', at: row.droppingSubmittedAt },
      ],
    });
  }

  return out;
}

// ─── Per-store aggregation ───────────────────────────────────────────────────

export interface StoreMeta {
  id: number;
  name: string;
  storeNo: string;
  areaId: string | null;
  areaName: string | null;
}

export interface Count { total: number; done: number }

export interface StoreReport extends StoreMeta {
  total: number;
  done: number;
  /** Sum of minutes over the DONE ones that have a clock (so averages can be pooled across stores). */
  minutes: number;
  /** How many of the done ones that `minutes` covers (a receipt BC closed with no store photo has no clock). */
  timed: number;
  /** Open ones whose clock hasn't started — an Item Receiving the store hasn't photographed yet. */
  notStarted: number;
  /** How long the longest-waiting open one (with a running clock) has been waiting (null = none). */
  oldestOpenMinutes: number | null;
  /** Per Jakarta day (only days that had a process). */
  days: Record<string, Count>;
}

export function emptyStoreReport(meta: StoreMeta): StoreReport {
  return { ...meta, total: 0, done: 0, minutes: 0, timed: 0, notStarted: 0, oldestOpenMinutes: null, days: {} };
}

function minutes(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

/** Every store in `stores` (even with none), counting `process` that started on `days`. */
export function buildStoreReports(
  stores: StoreMeta[],
  rows: ReportRow[],
  days: string[],
  process: Process,
  now: Date = new Date(),
): StoreReport[] {
  const inPeriod = new Set(days);
  const byId = new Map(stores.map((s) => [s.id, emptyStoreReport(s)]));

  for (const row of rows) {
    for (const item of legsOf(row)) {
      if (item.process !== process) continue;
      const store = byId.get(item.storeId);
      if (!store || !inPeriod.has(item.day)) continue;

      store.total += 1;
      const day = (store.days[item.day] ??= { total: 0, done: 0 });
      day.total += 1;

      if (item.doneAt) {
        store.done += 1;
        day.done += 1;
        if (item.startedAt) {
          store.minutes += minutes(item.startedAt, item.doneAt);
          store.timed += 1;
        }
      } else if (item.startedAt) {
        const waiting = minutes(item.startedAt, now);
        if (store.oldestOpenMinutes == null || waiting > store.oldestOpenMinutes) store.oldestOpenMinutes = waiting;
      } else {
        store.notStarted += 1;
      }
    }
  }

  return [...byId.values()];
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface ReportTotals {
  total: number;
  done: number;
  open: number;
  /** Whole percent; 0 when there is nothing. */
  rate: number;
  /** Stores that had at least one / still have something open. */
  storesWithTo: number;
  storesOpen: number;
  /** Open ones whose clock hasn't started (Item Receiving not yet photographed). */
  notStarted: number;
  /** Mean duration over finished ones that had a clock (null = none yet). */
  avgMinutes: number | null;
  /** The longest an open one has been waiting, across stores (null = none open). */
  longestWaitMinutes: number | null;
}

export const pct = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);

export function summarise(reports: StoreReport[]): ReportTotals {
  const t: ReportTotals = {
    total: 0, done: 0, open: 0, rate: 0, storesWithTo: 0, storesOpen: 0, notStarted: 0, avgMinutes: null, longestWaitMinutes: null,
  };
  let sum = 0;
  let timed = 0;

  for (const s of reports) {
    t.total += s.total;
    t.done += s.done;
    t.notStarted += s.notStarted;
    sum += s.minutes;
    timed += s.timed;
    if (s.total > 0) t.storesWithTo += 1;
    if (s.done < s.total) t.storesOpen += 1;
    if (s.oldestOpenMinutes != null && (t.longestWaitMinutes == null || s.oldestOpenMinutes > t.longestWaitMinutes)) {
      t.longestWaitMinutes = s.oldestOpenMinutes;
    }
  }

  t.open = t.total - t.done;
  t.rate = pct(t.done, t.total);
  t.avgMinutes = timed > 0 ? Math.round(sum / timed) : null;
  return t;
}

/** A store's own average, for its row (null = nothing finished with a clock). */
export function avgMinutes(report: StoreReport): number | null {
  return report.timed > 0 ? Math.round(report.minutes / report.timed) : null;
}

// ─── List helpers (filter + sort) ────────────────────────────────────────────

export type ReportFilter = 'all' | 'open' | 'complete' | 'none';
export type ReportSort = 'attention' | 'oldest' | 'progress' | 'volume' | 'name';

export function matchesFilter(s: StoreReport, filter: ReportFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return s.total === 0;
  if (filter === 'open') return s.total > 0 && s.done < s.total;
  return s.total > 0 && s.done === s.total;
}

export function filterCounts(reports: StoreReport[]): Record<ReportFilter, number> {
  return {
    all: reports.length,
    open: reports.filter((s) => matchesFilter(s, 'open')).length,
    complete: reports.filter((s) => matchesFilter(s, 'complete')).length,
    none: reports.filter((s) => matchesFilter(s, 'none')).length,
  };
}

/**
 * attention = lowest completion % first, then the most still open; oldest = the
 * store with the longest-waiting open process first. Stores with nothing to do
 * sink to the bottom of every sort but name / volume.
 */
export function sortReports(reports: StoreReport[], sort: ReportSort): StoreReport[] {
  const byName = (a: StoreReport, b: StoreReport) => a.name.localeCompare(b.name);
  return [...reports].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'volume') return b.total - a.total || byName(a, b);

    const noA = a.total === 0 ? 1 : 0;
    const noB = b.total === 0 ? 1 : 0;
    if (noA !== noB) return noA - noB;

    if (sort === 'oldest') {
      const wa = a.oldestOpenMinutes ?? -1;
      const wb = b.oldestOpenMinutes ?? -1;
      return wb - wa || byName(a, b);
    }
    if (sort === 'progress') return pct(b.done, b.total) - pct(a.done, a.total) || b.total - a.total || byName(a, b);
    return (
      pct(a.done, a.total) - pct(b.done, b.total) ||
      (b.total - b.done) - (a.total - a.done) ||
      byName(a, b)
    );
  });
}

export function matchesSearch(s: StoreMeta, area: string, query: string): boolean {
  if (area !== 'all' && s.areaName !== area) return false;
  const q = query.trim().toLowerCase();
  return !q || `${s.name} ${s.storeNo} ${s.areaName ?? ''}`.toLowerCase().includes(q);
}

// ─── Drill-down (one store's processes) ──────────────────────────────────────

export interface ReportItem {
  rowId: number;
  toaNo: string;
  process: Process;
  counterpartCode: string;
  counterpartName: string | null;
  /** The other end is a DM warehouse, not a store. */
  counterpartIsWarehouse: boolean;
  qty: number;
  /** When it entered the report (Item Receiving: WS Diposting). */
  anchorAt: string;
  /** When its clock started; null = not yet. */
  startedAt: string | null;
  doneAt: string | null;
  done: boolean;
  /** Start → done, or start → now while still open. Null = no clock (not started, or closed in BC with no store photo). */
  minutes: number | null;
  /** The timeline recorded for this item (ISO, null = not yet). */
  steps: { label: string; at: string | null; signed: boolean }[];
}

/** A store's processes of one kind in the period, the open ones first (oldest first). */
export function buildStoreItems(
  storeId: number,
  rows: ReportRow[],
  days: string[],
  process: Process,
  opts: {
    now: Date;
    nameByCode: Map<string, string>;
    isWarehouseCode: (code: string) => boolean;
  },
): ReportItem[] {
  const inPeriod = new Set(days);
  const items: ReportItem[] = [];

  for (const row of rows) {
    for (const leg of legsOf(row)) {
      if (leg.process !== process || leg.storeId !== storeId || !inPeriod.has(leg.day)) continue;
      items.push({
        rowId: leg.rowId,
        toaNo: leg.toaNo,
        process: leg.process,
        counterpartCode: leg.counterpartCode,
        counterpartName: opts.nameByCode.get(leg.counterpartCode) ?? null,
        counterpartIsWarehouse: opts.isWarehouseCode(leg.counterpartCode),
        qty: leg.qty,
        anchorAt: leg.anchorAt.toISOString(),
        startedAt: leg.startedAt?.toISOString() ?? null,
        doneAt: leg.doneAt?.toISOString() ?? null,
        done: leg.doneAt != null,
        minutes: leg.startedAt ? minutes(leg.startedAt, leg.doneAt ?? opts.now) : null,
        steps: leg.steps.map((s) => ({ label: s.label, at: s.at?.toISOString() ?? null, signed: s.signed === true })),
      });
    }
  }

  return items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    // open: the one that has been outstanding longest first (by when it entered the list);
    // done: most recently finished first
    return a.done
      ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '')
      : a.anchorAt.localeCompare(b.anchorAt);
  });
}

// ─── Wire types (API ↔ page) ─────────────────────────────────────────────────

export interface TransferReportResponse {
  success: boolean;
  error?: string;
  process: Process;
  from: string;
  to: string;
  scope: 'all_areas' | 'area';
  areaName: string | null;
  generatedAt: string;
  stores: StoreReport[];
}

export interface TransferReportStoreResponse {
  success: boolean;
  error?: string;
  process: Process;
  from: string;
  to: string;
  store: StoreReport | null;
  items: ReportItem[];
}

/** Every Jakarta day key from `from` through `to`, inclusive (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
