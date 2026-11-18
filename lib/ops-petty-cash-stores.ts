// lib/ops-petty-cash-stores.ts
//
// Shapes + view logic for Ops · Petty Cash · Stores (/ops/petty-cash/stores) — client-safe, no DB imports.
//
// One row per store: where its petty cash stands RIGHT NOW — the period in use, the cash PIC 1 can spend, what
// was used in that period, what is still open (waiting on OPS / on PIC 1) and where its Refill is. Read-only: the
// approve / reject actions stay on the Requests and Refills pages. Data: lib/db/utils/petty-cash-ops-stores.ts.
//
// ONE status per store (`storeStatusOf`), most urgent first — the chip in the row, the status filter and the
// "Needs action" sort all use it.

import { matchesQuery, type SortDir } from '@/lib/ops-petty-cash';
import type { RefillState } from '@/lib/petty-cash-report';
import type { Tone } from '@/lib/status-theme';

export type { SortDir };

/** The most a store's petty cash holds (PETTY_CASH_MAX_BALANCE — not imported: that module pulls in the schema). */
export const PETTY_CASH_MAX = 1_000_000;

/** Below this share of the maximum the balance counts as low (same 30 % / 60 % bands as Finance's Monitoring). */
export const LOW_BALANCE_PCT = 30;
export const WATCH_BALANCE_PCT = 60;

// ─── Rows ────────────────────────────────────────────────────────────────────

/** Where the store's Refill stands. */
export type StoreRefill =
  /** A Refill on its way (waiting on OPS, on Finance, or on PIC 1's proof photos). */
  | { kind: 'live'; id: number; month: string; state: RefillState; amount: number; requestedAt: string; late: boolean }
  /** A period has ended, was used and nobody sent its Refill — PIC 1 can't file new requests until they do. */
  | { kind: 'overdue'; month: string; amount: number }
  /** The period in use was used and its Refill is due within a few days (the 15th). */
  | { kind: 'due_soon'; month: string; amount: number; daysLeft: number }
  /** Nothing on its way: the latest Refill the store sent (received or turned down). */
  | { kind: 'last'; id: number; month: string; state: RefillState; amount: number; requestedAt: string }
  /** The store never sent a Refill. */
  | { kind: 'none' };

export interface PettyCashStoreRow {
  storeId: number;
  storeNo: string;
  storeName: string;
  areaId: number;
  areaName: string;
  /** `active` or `close` (stores still getting ready to open have no petty cash and are left out). */
  storeStatus: 'active' | 'close';

  /** The petty cash holder(s) of the store — more than one is flagged elsewhere (lib/store-pic1.ts). */
  pic1: { id: string; name: string; nik: string }[];

  /** The period new requests go to right now (YYYY-MM). */
  periodMonth: string;
  /** What that period has left on paper (the usage ledger, `current_balance`). */
  ledgerBalance: number;
  /** The cash PIC 1 can really spend: the ledger minus the previous Refill not received yet, plus this period's own once received. */
  spendable: number;
  /** The previous period's Refill the cash box is still waiting for (0 = none). */
  owed: number;
  /** Completed requests of the period in use that count as used (actual amount). */
  used: number;
  /** Completed requests of the period in use. */
  completedCount: number;

  /** Spending requests waiting for OPS (any period). */
  waitingOps: number;
  /** Approved by OPS, PIC 1 has not recorded the actual amount yet. */
  awaitingActual: number;
  /** Sent back by Finance (Perlu Perbaikan), PIC 1 is fixing them. */
  fixing: number;

  refill: StoreRefill;

  /** When the store last filed a request (ISO), null = never. */
  lastRequestAt: string | null;
}

export interface PettyCashStoresResponse {
  success: true;
  scope: 'area' | 'all_areas';
  /** Jakarta day the figures are for (YYYY-MM-DD). */
  today: string;
  maxBalance: number;
  stores: PettyCashStoreRow[];
}

// ─── Store status ────────────────────────────────────────────────────────────

export type StoreStatusKey =
  | 'waiting_ops'
  | 'refill_overdue'
  | 'waiting_pic'
  | 'refill_on_way'
  | 'ok'
  | 'idle'
  | 'closed';

export const STORE_STATUS_ORDER: StoreStatusKey[] = [
  'waiting_ops',
  'refill_overdue',
  'waiting_pic',
  'refill_on_way',
  'ok',
  'idle',
  'closed',
];

export const STORE_STATUS_META: Record<StoreStatusKey, { label: string; hint: string; tone: Tone }> = {
  waiting_ops: { label: 'Waiting OPS', hint: 'A request or a Refill is waiting for OPS to approve.', tone: 'warning' },
  refill_overdue: {
    label: 'Refill overdue',
    hint: 'A period has ended without its Refill — PIC 1 can’t file new requests until it is sent.',
    tone: 'danger',
  },
  waiting_pic: {
    label: 'Waiting PIC 1',
    hint: 'PIC 1 still has to record an actual amount or fix a request Finance sent back.',
    tone: 'info',
  },
  refill_on_way: { label: 'Refill on its way', hint: 'Approved by OPS — Finance / the store still to finish it.', tone: 'active' },
  ok: { label: 'OK', hint: 'Nothing open.', tone: 'success' },
  idle: { label: 'No activity', hint: 'No request in the period in use yet.', tone: 'neutral' },
  closed: { label: 'Closed', hint: 'The store is closed.', tone: 'muted' },
};

/** Chip-dot colour per status for OpsChipTabs / ChipScroller (the same hues as STORE_STATUS_META's tones). */
export const STORE_STATUS_DOT: Record<StoreStatusKey, 'amber' | 'rose' | 'sky' | 'indigo' | 'emerald' | 'slate'> = {
  waiting_ops: 'amber',
  refill_overdue: 'rose',
  waiting_pic: 'sky',
  refill_on_way: 'indigo',
  ok: 'emerald',
  idle: 'slate',
  closed: 'slate',
};

export const waitingOpsOf = (r: PettyCashStoreRow): number =>
  r.waitingOps + (r.refill.kind === 'live' && r.refill.state === 'pending' ? 1 : 0);

export function storeStatusOf(r: PettyCashStoreRow): StoreStatusKey {
  if (r.storeStatus === 'close') return 'closed';
  if (waitingOpsOf(r) > 0) return 'waiting_ops';
  if (r.refill.kind === 'overdue') return 'refill_overdue';
  if (r.awaitingActual + r.fixing > 0) return 'waiting_pic';
  if (r.refill.kind === 'live') return 'refill_on_way';
  if (r.completedCount === 0) return 'idle';
  return 'ok';
}

/** Share of the maximum the store can spend, 0–100. */
export const balancePct = (r: Pick<PettyCashStoreRow, 'spendable'>, max = PETTY_CASH_MAX): number =>
  Math.max(0, Math.min(100, Math.round((r.spendable / max) * 100)));

export type BalanceBand = 'low' | 'watch' | 'ok';

export function balanceBand(r: Pick<PettyCashStoreRow, 'spendable'>, max = PETTY_CASH_MAX): BalanceBand {
  const pct = balancePct(r, max);
  return pct < LOW_BALANCE_PCT ? 'low' : pct < WATCH_BALANCE_PCT ? 'watch' : 'ok';
}

// ─── Filter / sort / totals ──────────────────────────────────────────────────

export interface StoreFilters {
  query: string;
  area: 'all' | number;
  store: number | null;
}

/** Everything but the status — so each status chip can count what it would give. */
export function filterStoresExceptStatus(rows: PettyCashStoreRow[], f: StoreFilters): PettyCashStoreRow[] {
  return rows.filter((r) => {
    if (f.area !== 'all' && r.areaId !== f.area) return false;
    if (f.store != null && r.storeId !== f.store) return false;
    return matchesQuery([r.storeNo, r.storeName, r.areaName, ...r.pic1.flatMap((p) => [p.name, p.nik])], f.query);
  });
}

export function countStoresByStatus(rows: PettyCashStoreRow[]): Record<StoreStatusKey, number> {
  const out = Object.fromEntries(STORE_STATUS_ORDER.map((k) => [k, 0])) as Record<StoreStatusKey, number>;
  for (const r of rows) out[storeStatusOf(r)] += 1;
  return out;
}

export type StoreSortKey = 'priority' | 'store' | 'balance' | 'used' | 'activity';

export const STORE_SORT_OPTIONS: { key: StoreSortKey; label: string }[] = [
  { key: 'priority', label: 'Needs action' },
  { key: 'store', label: 'Store' },
  { key: 'balance', label: 'Balance' },
  { key: 'used', label: 'Used' },
  { key: 'activity', label: 'Last request' },
];

/** The direction a key starts in when first picked: lowest balance first, most used / most recent first. */
export function defaultStoreSortDir(key: StoreSortKey): SortDir {
  return key === 'used' || key === 'activity' ? 'desc' : 'asc';
}

const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
const statusRank = (r: PettyCashStoreRow) => STORE_STATUS_ORDER.indexOf(storeStatusOf(r));
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function sortStores(rows: PettyCashStoreRow[], key: StoreSortKey, dir: SortDir): PettyCashStoreRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: PettyCashStoreRow, b: PettyCashStoreRow) => collator.compare(a.storeName, b.storeName);
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'priority':
        // Within a status: the emptiest cash box first.
        return sign * (statusRank(a) - statusRank(b)) || a.spendable - b.spendable || byName(a, b);
      case 'store':
        return sign * byName(a, b);
      case 'balance':
        return sign * (a.spendable - b.spendable) || byName(a, b);
      case 'used':
        return sign * (a.used - b.used) || byName(a, b);
      case 'activity':
        return sign * (time(a.lastRequestAt) - time(b.lastRequestAt)) || byName(a, b);
    }
  });
}

export interface StoreTotals {
  stores: number;
  spendable: number;
  used: number;
  /** Requests + Refills waiting for OPS. */
  waitingOps: number;
  refillOverdue: number;
  lowBalance: number;
}

export function totalsOfStores(rows: PettyCashStoreRow[]): StoreTotals {
  const t: StoreTotals = { stores: rows.length, spendable: 0, used: 0, waitingOps: 0, refillOverdue: 0, lowBalance: 0 };
  for (const r of rows) {
    if (r.storeStatus === 'close') continue;
    t.spendable += r.spendable;
    t.used += r.used;
    t.waitingOps += waitingOpsOf(r);
    if (r.refill.kind === 'overdue') t.refillOverdue += 1;
    if (balanceBand(r) === 'low') t.lowBalance += 1;
  }
  return t;
}

// ─── Store detail (the slide-over) ───────────────────────────────────────────

export interface StoreDetailRequest {
  id: number;
  createdAt: string;
  submittedByName: string;
  categoryName: string | null;
  description: string;
  amount: number;
  actualAmount: number | null;
  status: string;
  financeReview: string | null;
  isReRequest: boolean;
  periodMonth: string;
  imageUrl: string | null;
}

export interface StoreDetailRefill {
  id: number;
  month: string;
  requestedAt: string;
  requestedByName: string | null;
  state: RefillState;
  /** The frozen transfer once Finance verified, else what the period needed when it was sent (max − balance). */
  amount: number;
  late: boolean;
}

export interface PettyCashStoreDetailResponse {
  success: true;
  store: PettyCashStoreRow;
  /** The period in use and the one before it (plus anything still open from earlier), newest first. */
  requests: StoreDetailRequest[];
  /** The store's latest Refills, newest first. */
  refills: StoreDetailRefill[];
}
