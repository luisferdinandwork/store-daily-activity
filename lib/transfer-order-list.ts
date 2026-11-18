// lib/transfer-order-list.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure view logic of the OPS Transfer Order list (/ops/transfer-order): the
// filters and sorts of its toolbar. Client-safe (no DB, no React) so the rules
// are testable on their own; the page only draws them.
//
//   filters  status (phase chips) · area · store + arah · rute · TO Dibuat ·
//            Total Proses longer than · data flags (WS tidak tercatat / waktu terbalik)
//   sorts    TO Dibuat · Total Proses · each timing metric · No. TO · Qty · toko asal
//
// A duration sort uses the metric as the page shows it (lib/transfer-order-metrics.ts):
// a finished one is its final duration, an open one its running time so far. A row
// with no number for that metric (N/A, not started, "tidak tercatat") always sinks to
// the bottom, whichever way the list is sorted.
// ─────────────────────────────────────────────────────────────────────────────

import { jakartaDateKey } from '@/lib/day-bucket';
import { buildTransferMetrics, minutesBetween, type MetricInput, type MetricKey } from '@/lib/transfer-order-metrics';

/** The fields of a transfer the list needs (the page's own type has more). */
export interface ListTransfer extends MetricInput {
  id: string;
  toaNo: string;
  transferFromCode: string;
  transferToCode: string;
  qtyOrdered: number;
  phase: string;
  fromStore: { id: string; name: string; storeNo: string; areaId: string | null } | null;
  toStore: { id: string; name: string; storeNo: string; areaId: string | null } | null;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export type RouteKind = 'store_store' | 'to_warehouse' | 'from_warehouse' | 'warehouse_warehouse';

export const ROUTE_LABEL: Record<RouteKind, string> = {
  store_store: 'Toko → Toko',
  to_warehouse: 'Toko → Gudang',
  from_warehouse: 'Gudang → Toko',
  warehouse_warehouse: 'Gudang → Gudang',
};

export function routeOf(t: Pick<ListTransfer, 'fromIsWarehouse' | 'toIsWarehouse'>): RouteKind {
  if (t.fromIsWarehouse && t.toIsWarehouse) return 'warehouse_warehouse';
  if (t.fromIsWarehouse) return 'from_warehouse';
  if (t.toIsWarehouse) return 'to_warehouse';
  return 'store_store';
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type Direction = 'all' | 'from' | 'to';
export type CreatedRange = 'all' | 'today' | '7d' | '30d' | 'this_month' | 'last_month';
export type LongerThan = 'all' | '1d' | '3d' | '7d';
export type DataFlag = 'all' | 'no_ws' | 'reversed';

export const DIRECTION_LABEL: Record<Exclude<Direction, 'all'>, string> = {
  from: 'Keluar · Item Return',
  to: 'Masuk · Item Receiving',
};
export const CREATED_LABEL: Record<Exclude<CreatedRange, 'all'>, string> = {
  today: 'Hari ini',
  '7d': '7 hari terakhir',
  '30d': '30 hari terakhir',
  this_month: 'Bulan ini',
  last_month: 'Bulan lalu',
};
export const LONGER_LABEL: Record<Exclude<LongerThan, 'all'>, string> = {
  '1d': 'Total > 1 hari',
  '3d': 'Total > 3 hari',
  '7d': 'Total > 7 hari',
};
export const DATA_FLAG_LABEL: Record<Exclude<DataFlag, 'all'>, string> = {
  no_ws: 'WS tidak tercatat',
  reversed: 'Waktu terbalik',
};
const LONGER_MINUTES: Record<Exclude<LongerThan, 'all'>, number> = { '1d': 1440, '3d': 3 * 1440, '7d': 7 * 1440 };

export interface ListFilters {
  /** Free text: TO no, store codes / names on either end. */
  search: string;
  /** An area id (either end's store is in it), or 'all'. */
  area: string;
  /** A store id, or 'all'; read together with `direction`. */
  store: string;
  direction: Direction;
  route: 'all' | RouteKind;
  created: CreatedRange;
  longerThan: LongerThan;
  data: DataFlag;
}

export const EMPTY_FILTERS: ListFilters = {
  search: '', area: 'all', store: 'all', direction: 'all', route: 'all', created: 'all', longerThan: 'all', data: 'all',
};

/** How many of the "Filter" popover's filters are in use (the badge on its button). */
export function moreFilterCount(f: ListFilters): number {
  return [f.direction !== 'all', f.route !== 'all', f.created !== 'all', f.longerThan !== 'all', f.data !== 'all'].filter(Boolean).length;
}

const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;

/** Is this Jakarta day (YYYY-MM-DD) inside the range, seen from `today`? */
export function dayInRange(day: string | null, range: CreatedRange, today: string): boolean {
  if (range === 'all') return true;
  if (!day) return false;
  const diff = dayNumber(today) - dayNumber(day);
  switch (range) {
    case 'today': return diff === 0;
    case '7d': return diff >= 0 && diff < 7;
    case '30d': return diff >= 0 && diff < 30;
    case 'this_month': return day.slice(0, 7) === today.slice(0, 7);
    case 'last_month': {
      const y = +today.slice(0, 4);
      const m = +today.slice(5, 7);
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      return day.slice(0, 7) === prev;
    }
  }
}

/** Everything the list needs about one row, computed once: its route and every metric's minutes. */
export interface RowFacts {
  route: RouteKind;
  /** Jakarta day of TO Dibuat (null = not seen in BC's TO feed). */
  createdDay: string | null;
  /** Minutes per metric as the page shows it (final, or running while open); null = no number. */
  minutes: Record<MetricKey, number | null>;
  /** Finished in BC with no WS Diposting ever recorded. */
  noWs: boolean;
  /** At least one metric whose end was recorded before its start. */
  reversed: boolean;
}

export function rowFacts(t: ListTransfer, now: number): RowFacts {
  const metrics = buildTransferMetrics(t);
  const minutes = {} as Record<MetricKey, number | null>;
  for (const m of metrics) {
    minutes[m.key] = !m.applicable || m.skipped || !m.start ? null : minutesBetween(m.start, m.end, { signed: m.signed, now });
  }
  return {
    route: routeOf(t),
    createdDay: t.returnDetectedAt ? jakartaDateKey(new Date(t.returnDetectedAt)) : null,
    minutes,
    noWs: Boolean(t.receivedAt) && !t.droppingDetectedAt,
    reversed: metrics.some((m) => m.reversed),
  };
}

function matchesStore(t: ListTransfer, store: string, direction: Direction): boolean {
  if (direction === 'from') return store === 'all' ? !!t.fromStore : t.fromStore?.id === store;
  if (direction === 'to') return store === 'all' ? !!t.toStore : t.toStore?.id === store;
  return store === 'all' || t.fromStore?.id === store || t.toStore?.id === store;
}

/** Every filter but the status chips (the chips' counts follow these). */
export function matchesFilters(t: ListTransfer, facts: RowFacts, f: ListFilters, today: string): boolean {
  if (!matchesStore(t, f.store, f.direction)) return false;
  if (f.area !== 'all' && t.fromStore?.areaId !== f.area && t.toStore?.areaId !== f.area) return false;
  if (f.route !== 'all' && facts.route !== f.route) return false;
  if (!dayInRange(facts.createdDay, f.created, today)) return false;
  if (f.longerThan !== 'all') {
    const total = facts.minutes.total;
    if (total == null || total <= LONGER_MINUTES[f.longerThan]) return false;
  }
  if (f.data === 'no_ws' && !facts.noWs) return false;
  if (f.data === 'reversed' && !facts.reversed) return false;

  const q = f.search.trim().toLowerCase();
  if (!q) return true;
  return [t.toaNo, t.transferFromCode, t.transferToCode, t.fromStore?.name, t.toStore?.name]
    .some((v) => (v ?? '').toLowerCase().includes(q));
}

// ─── Sort ────────────────────────────────────────────────────────────────────

export type ListSortKey = 'created' | MetricKey | 'toaNo' | 'qty' | 'origin';

export const LIST_SORT_OPTIONS: { key: ListSortKey; label: string }[] = [
  { key: 'created', label: 'TO Dibuat' },
  { key: 'total', label: 'Total Proses' },
  { key: 'bcProcessing', label: 'TO → WS' },
  { key: 'wsToReturn', label: 'WS → Terima Kurir' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'bcReceiving', label: 'Terima BC' },
  { key: 'toaNo', label: 'No. TO' },
  { key: 'qty', label: 'Qty' },
  { key: 'origin', label: 'Toko asal' },
];

/** Newest / longest / biggest first; names and TO numbers A → Z. */
export const defaultListSortDir = (key: ListSortKey): 'asc' | 'desc' =>
  key === 'origin' || key === 'toaNo' ? 'asc' : 'desc';

const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

export function sortTransfers<T extends ListTransfer>(
  rows: T[],
  facts: Map<string, RowFacts>,
  key: ListSortKey,
  dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (t: T): number | string | null => {
    switch (key) {
      case 'created': return t.returnDetectedAt ? new Date(t.returnDetectedAt).getTime() : null;
      case 'toaNo': return t.toaNo;
      case 'qty': return t.qtyOrdered;
      case 'origin': return t.fromStore?.name ?? t.transferFromCode;
      default: return facts.get(t.id)?.minutes[key] ?? null;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return collator.compare(b.toaNo, a.toaNo);
    if (va == null) return 1;
    if (vb == null) return -1;
    const diff = typeof va === 'string' || typeof vb === 'string'
      ? collator.compare(String(va), String(vb))
      : va - vb;
    return sign * diff || collator.compare(b.toaNo, a.toaNo);
  });
}

export const LIST_PAGE_SIZE = 50;
