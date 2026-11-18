// lib/db/utils/transfer-order-refresh.ts
// ─────────────────────────────────────────────────────────────────────────────
// The one entry point for pulling Business Central into the transfer-order
// registry. Many things want a fresh registry — the 5-minute cron, an employee
// opening Transfer Orders, the header-badge poll, the OPS dashboard — and
// every one of them used to run its own BC sync (the OPS dashboard alone made
// 20+ round trips per load). Now they all call this, which guarantees:
//
//  • single-flight: callers arriving while a refresh is running share it;
//  • throttle: a refresh that finished within `maxAgeMs` is reused, so N
//    employees + OPS cost one BC sweep per window, not N;
//  • a LIGHT sweep (last 14 days) by default — cheap enough to run every few
//    minutes to notice new orders/shipments and settle recent orders BC
//    cancelled or finished — and a FULL sweep (90 days, every open order
//    reconciled) at most every 6 hours (and on first run);
//  • the "new transfer order" notifications run after every sweep, even a
//    failed one (they only read the DB), so a store that wasn't staffed when
//    an order landed is still told as soon as somebody is scheduled.
//
// State lives in-process (globalThis, so dev HMR keeps it). The production
// server is a single PM2 fork (ecosystem.config.js); if it ever goes to
// cluster mode each worker just does its own throttled sweep — still correct,
// the notification claim is atomic in the DB.
//
// Neither function ever rejects — failures come back as `error`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  LIGHT_LOOKBACK_DAYS,
  syncReceivingStatus,
  syncTransferOrderRegistry,
} from '@/lib/db/utils/item-transfers';
import {
  notifyStoresOfOpenTransfers,
  type TransferNotifyResult,
} from '@/lib/db/utils/transfer-order-notifications';

const FULL_SWEEP_EVERY_MS = 6 * 3_600_000;

export interface RegistryRefresh {
  /** false = served from the throttle window, nothing was fetched. */
  ran: boolean;
  full: boolean;
  /** The Business Central sweep failed (data may be stale). */
  error: string | null;
  synced: number;
  /** Orders BC cancelled (gone from BC, no Posted Whse Receipt) — removed from PRISM. */
  cancelled: number;
  /** Orders BC finished (gone from BC, receipt posted) — completed in PRISM. */
  autoCompleted: number;
  notified: TransferNotifyResult | null;
  /** The sweep worked but announcing to stores failed. */
  notifyError: string | null;
}

export interface ReceivingRefresh {
  ran: boolean;
  error: string | null;
  closed: number;
  /** Of `closed`: orders with a store leg nobody processed in PRISM (Selesai Otomatis). */
  autoCompleted: number;
}

interface Slot<T> {
  inFlight: Promise<T> | null;
  lastAttemptAt: number;
  last: T | null;
}

interface RefreshState {
  registry: Slot<RegistryRefresh>;
  receiving: Slot<ReceivingRefresh>;
  lastFullAt: number;
}

const g = globalThis as typeof globalThis & { __transferOrderRefresh?: RefreshState };
const state: RefreshState = (g.__transferOrderRefresh ??= {
  registry: { inFlight: null, lastAttemptAt: 0, last: null },
  receiving: { inFlight: null, lastAttemptAt: 0, last: null },
  lastFullAt: 0,
});

function throttled<T extends { ran: boolean }>(
  slot: Slot<T>,
  maxAgeMs: number,
  run: () => Promise<T>,
): Promise<T> {
  if (slot.inFlight) return slot.inFlight;
  if (maxAgeMs > 0 && slot.last && Date.now() - slot.lastAttemptAt < maxAgeMs) {
    return Promise.resolve({ ...slot.last, ran: false });
  }
  const p = run()
    .then((out) => {
      slot.last = out;
      slot.lastAttemptAt = Date.now();
      return out;
    })
    .finally(() => {
      slot.inFlight = null;
    });
  slot.inFlight = p;
  return p;
}

function automaticPushAllowed(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.TRANSFER_NOTIFY_DEV === '1';
}

async function runRegistry(): Promise<RegistryRefresh> {
  const startedAt = Date.now();
  const full = startedAt - state.lastFullAt >= FULL_SWEEP_EVERY_MS;

  let error: string | null = null;
  let synced = 0;
  let cancelled = 0;
  let autoCompleted = 0;

  const res = await syncTransferOrderRegistry(full ? {} : { lookbackDays: LIGHT_LOOKBACK_DAYS, prune: false });
  if (res.success) {
    synced = res.data.synced;
    cancelled = res.data.cancelled;
    autoCompleted = res.data.autoCompleted;
    if (full) state.lastFullAt = startedAt;
  } else {
    error = res.error;
    console.error('[transfer-orders] registry sweep failed:', res.error);
  }

  let notified: TransferNotifyResult | null = null;
  let notifyError: string | null = null;
  try {
    // Automatic sweeps push to real staff only from the real server. A developer
    // running `next dev` against the production database (it happens — see
    // .env.local) must not announce transfers to hundreds of employees just by
    // opening a page. TRANSFER_NOTIFY_DEV=1 opts a dev server back in; tests aim
    // notifyStoresOfOpenTransfers({ storeIds }) at a dummy store directly.
    if (automaticPushAllowed()) notified = await notifyStoresOfOpenTransfers();
  } catch (err) {
    notifyError = `${err}`;
    console.error('[transfer-orders] notify failed:', err);
  }

  return { ran: true, full, error, synced, cancelled, autoCompleted, notified, notifyError };
}

async function runReceiving(): Promise<ReceivingRefresh> {
  const res = await syncReceivingStatus('all');
  if (!res.success) {
    console.error('[transfer-orders] receiving sweep failed:', res.error);
    return { ran: true, error: res.error, closed: 0, autoCompleted: 0 };
  }
  return { ran: true, error: null, closed: res.data.closed, autoCompleted: res.data.autoCompleted };
}

/**
 * Pulls new/changed transfer orders + warehouse shipments from BC into the
 * registry and announces new ones to the stores. `maxAgeMs: 0` forces a sweep
 * (the cron); otherwise a sweep that finished that recently is reused.
 */
export function refreshTransferRegistry(opts: { maxAgeMs: number }): Promise<RegistryRefresh> {
  return throttled(state.registry, opts.maxAgeMs, () =>
    runRegistry().catch((err): RegistryRefresh => ({
      ran: true, full: false, error: `${err}`, synced: 0, cancelled: 0, autoCompleted: 0, notified: null, notifyError: null,
    })),
  );
}

/** Closes finished transfers (BC posted the receipt) company-wide. */
export function refreshReceivingStatus(opts: { maxAgeMs: number }): Promise<ReceivingRefresh> {
  return throttled(state.receiving, opts.maxAgeMs, () =>
    runReceiving().catch((err): ReceivingRefresh => ({
      ran: true, error: `${err}`, closed: 0, autoCompleted: 0,
    })),
  );
}
