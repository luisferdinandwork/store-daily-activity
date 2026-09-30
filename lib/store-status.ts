// lib/store-status.ts
//
// Store lifecycle — pure + client-safe (no DB). The DB side (transitions,
// history, petty-cash activation) lives in lib/db/utils/store-status.ts.
//
//   ready_to_open ──activate──▶ active ──close──▶ close
//                                  ▲                │
//                                  └───── reopen ───┘
//
// • active         Fully operational: employees check in, tasks are created,
//                  petty cash is provisioned. Every store predating this
//                  field is `active`.
// • ready_to_open  Preparation only — Ops/PIC can build schedules and set
//                  performance targets, and the store is visible to IT/Finance
//                  (petty cash shows Rp 0), but nothing operational is
//                  recorded: no check-in, no tasks, no auto-absent, and it is
//                  left out of the Ops attendance/task progress rollups.
// • close          Retired. Behaves like ready_to_open for operations (nothing
//                  is recorded) but keeps its petty-cash balance untouched —
//                  the Audit close-out (next phase) reconciles it.

export const STORE_STATUSES = ['active', 'close', 'ready_to_open'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  active: 'Active',
  close: 'Close',
  ready_to_open: 'Ready to Open',
};

/** Tailwind classes for a status pill (ring style matches the Ops/IT badges). */
export const STORE_STATUS_BADGE: Record<StoreStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ready_to_open: 'bg-sky-50 text-sky-700 ring-sky-200',
  close: 'bg-slate-100 text-slate-500 ring-slate-200',
};

/** Allowed moves. Anything not listed (e.g. active → ready_to_open) is refused. */
export const STORE_STATUS_TRANSITIONS: Record<StoreStatus, readonly StoreStatus[]> = {
  ready_to_open: ['active', 'close'],
  active: ['close'],
  close: ['active'],
};

export function isStoreStatus(value: unknown): value is StoreStatus {
  return typeof value === 'string' && (STORE_STATUSES as readonly string[]).includes(value);
}

/** Only `active` stores take part in day-to-day operations. */
export function isStoreOperational(status: StoreStatus | string | null | undefined): boolean {
  return status === 'active';
}

export function canTransitionStoreStatus(from: StoreStatus, to: StoreStatus): boolean {
  return STORE_STATUS_TRANSITIONS[from].includes(to);
}

/** Employee-facing (Indonesian) reason shown when an inactive store blocks an action. */
export function storeInactiveMessage(status: StoreStatus | string | null | undefined): string {
  if (status === 'ready_to_open') {
    return 'Toko belum dibuka (Ready to Open). Absensi dan tugas akan aktif setelah toko diaktifkan.';
  }
  if (status === 'close') {
    return 'Toko ini sudah ditutup. Absensi dan tugas tidak dapat dicatat.';
  }
  return 'Toko tidak aktif.';
}
