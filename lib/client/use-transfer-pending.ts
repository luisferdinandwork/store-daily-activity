'use client';
// lib/client/use-transfer-pending.ts
// ─────────────────────────────────────────────────────────────────────────────
// How many Transfer Orders are waiting on the signed-in employee's store today —
// for the bottom-nav badge, the Quick Action row and anything else that wants it.
//
// ONE shared poll for the whole app, however many components read it: the first
// subscriber starts a 60-second interval, the last one stops it. It pauses while
// the tab / app is in the background and catches up the moment it returns, and
// `refreshTransferPending()` re-reads it on demand (after confirming a transfer).
// The endpoint is two count(*) queries — no Business Central call.
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

export interface TransferPending {
  /** Item Return + Item Receiving still open for the store. */
  count: number;
  /** Item Returns waiting to be handed to a courier. */
  returnCount: number;
  /** Shipments on their way, waiting to be received. */
  droppingCount: number;
  /** False until the first answer arrives. */
  loaded: boolean;
}

const POLL_INTERVAL_MS = 60_000;
const EMPTY: TransferPending = { count: 0, returnCount: 0, droppingCount: 0, loaded: false };

let state: TransferPending = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function emit() {
  for (const l of listeners) l();
}

async function load() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch('/api/employee/item-transfers/pending-count', { cache: 'no-store' });
    const json = await res.json();
    if (json?.success) {
      const next: TransferPending = {
        count: json.count ?? 0,
        returnCount: json.returnCount ?? 0,
        droppingCount: json.droppingCount ?? 0,
        loaded: true,
      };
      // A new object only when something changed, so subscribers don't re-render for nothing.
      if (
        next.count !== state.count || next.returnCount !== state.returnCount ||
        next.droppingCount !== state.droppingCount || !state.loaded
      ) {
        state = next;
        emit();
      }
    }
  } catch {
    // Silent — the badge just stays at its last known count.
  } finally {
    inFlight = false;
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void load();
}

function start() {
  void load();
  timer = setInterval(load, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisible);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Live pending counts; renders `EMPTY` on the server and until the first answer. */
export function useTransferPending(): TransferPending {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** Re-read the counts now (e.g. right after a transfer was confirmed). */
export function refreshTransferPending() {
  void load();
}
