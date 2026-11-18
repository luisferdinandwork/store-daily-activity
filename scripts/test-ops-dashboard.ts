// scripts/test-ops-dashboard.ts
// Pure-logic checks for the Ops Dashboard — no DB, no BC, no browser.
//   npm run test:ops-dashboard
//
// Covers: which stores "need attention" and in what order (lib/ops-dashboard.ts), the waiting-time
// wording + colour bands and the Monday–Sunday week (lib/ops-dashboard-queues.ts), and the
// transfer-order phase rule the dashboard shares with the Transfer Order page.

import assert from 'node:assert/strict';

import {
  ATTENTION_LIMIT,
  rateBand,
  storesBehind,
  type DashboardData,
  type StoreAttendanceRow,
  type StoreTaskRow,
} from '../lib/ops-dashboard';
import { dueThisWeek, waitingLabel, waitingMinutes, waitingTone, weekOf, weekRangeLabel } from '../lib/ops-dashboard-queues';
import { resolveTransferPhase, type TransferPhaseInput } from '../lib/transfer-order-phase';

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

// ─── Stores needing attention ────────────────────────────────────────────────

const taskRow = (storeNo: string, completed: number, total: number): StoreTaskRow => ({
  storeId: Number(storeNo.replace(/\D/g, '')),
  storeNo,
  storeName: `Toko ${storeNo}`,
  completed,
  total,
  completionRate: total ? Math.round((completed / total) * 100) : 0,
});

const attRow = (storeNo: string, present: number, late: number, absent: number, noSchedule = 0): StoreAttendanceRow => {
  const total = present + late + absent;
  return {
    storeId: storeNo,
    storeNo,
    storeName: `Toko ${storeNo}`,
    total,
    present,
    late,
    absent,
    dinas: 0,
    excused: 0,
    unset: 0,
    noSchedule,
    rate: total ? Math.round(((present + late) / total) * 100) : null,
  };
};

const dashboard = (tasks: StoreTaskRow[], stores: StoreAttendanceRow[]): DashboardData => ({
  date: '2026-11-18',
  scope: 'all_areas',
  storeCount: Math.max(tasks.length, stores.length),
  tasks: {
    today: { notStarted: 0, inProgress: 0, completed: 0, pending: 0, total: 0, completionRate: 0 },
    todayByStore: tasks,
  },
  attendance: { total: 0, present: 0, late: 0, absent: 0, dinas: 0, excused: 0, unset: 0, noSchedule: 0, rate: 0, stores },
});

console.log('Stores needing attention');

ok('tasks: worst rate first, 100% stores left out, cut to the limit with the full count kept', () => {
  const rows = ['FF001', 'FF002', 'FF003', 'FF004', 'FF005', 'FF006', 'FF007'].map((no, i) => taskRow(no, i, 10));
  rows.push(taskRow('FF008', 10, 10)); // done — not listed
  const b = storesBehind(dashboard(rows, []));
  assert.equal(b.tasks.length, ATTENTION_LIMIT);
  assert.equal(b.tasksTotal, 7);
  assert.deepEqual(b.tasks.map((s) => s.storeNo), ['FF001', 'FF002', 'FF003', 'FF004', 'FF005']);
});

ok('tasks: equal rates → the store with more tasks left comes first', () => {
  const b = storesBehind(dashboard([taskRow('FF010', 2, 4), taskRow('FF011', 5, 10)], []));
  assert.deepEqual(b.tasks.map((s) => s.storeNo), ['FF011', 'FF010']);
});

ok('attendance: lowest rate first; a store with staff but no shifts comes after the rated ones', () => {
  const b = storesBehind(
    dashboard([], [attRow('FF020', 3, 0, 1), attRow('FF021', 1, 0, 3), attRow('FF022', 0, 0, 0, 2), attRow('FF023', 4, 0, 0)]),
  );
  assert.deepEqual(b.attendance.map((s) => s.storeNo), ['FF021', 'FF020', 'FF022']); // FF023 is 100% and fully scheduled
  assert.equal(b.attendanceTotal, 3);
});

ok('attendance: a 100% store that has people with no schedule is still listed', () => {
  const b = storesBehind(dashboard([], [attRow('FF030', 4, 0, 0, 1)]));
  assert.equal(b.attendance.length, 1);
});

ok('nothing loaded → empty lists, not a crash', () => {
  const b = storesBehind(null);
  assert.deepEqual([b.tasks, b.attendance, b.tasksTotal, b.attendanceTotal], [[], [], 0, 0]);
});

ok('rate bands follow lib/status-theme.ts (80 / 50)', () => {
  assert.equal(rateBand(100), 'success');
  assert.equal(rateBand(80), 'success');
  assert.equal(rateBand(79), 'warning');
  assert.equal(rateBand(50), 'warning');
  assert.equal(rateBand(49), 'danger');
});

// ─── Waiting time ────────────────────────────────────────────────────────────

console.log('Waiting time');

const NOW = new Date('2026-11-18T10:00:00Z').getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

ok('label: minutes → hours → days, one unit', () => {
  assert.equal(waitingLabel(waitingMinutes(ago(0), NOW)), 'baru saja');
  assert.equal(waitingLabel(waitingMinutes(ago(45), NOW)), '45 mnt');
  assert.equal(waitingLabel(waitingMinutes(ago(60), NOW)), '1 jam');
  assert.equal(waitingLabel(waitingMinutes(ago(5 * 60 + 40), NOW)), '5 jam');
  assert.equal(waitingLabel(waitingMinutes(ago(24 * 60), NOW)), '1 hari');
  assert.equal(waitingLabel(waitingMinutes(ago(3 * 1440 + 600), NOW)), '3 hari');
});

ok('a start time in the future (clock skew) never shows a negative wait', () => {
  assert.equal(waitingMinutes(new Date(NOW + 3_600_000).toISOString(), NOW), 0);
});

ok('no start time → a dash, and the quiet tone', () => {
  assert.equal(waitingMinutes(null, NOW), null);
  assert.equal(waitingLabel(null), '—');
  assert.equal(waitingTone(null), 'muted');
});

ok('tone: calm under a day, warning from a day, danger from three', () => {
  assert.equal(waitingTone(23 * 60 + 59), 'neutral');
  assert.equal(waitingTone(1440), 'warning');
  assert.equal(waitingTone(3 * 1440 - 1), 'warning');
  assert.equal(waitingTone(3 * 1440), 'danger');
});

// ─── This week ───────────────────────────────────────────────────────────────

console.log('This week');

ok('weekOf: Monday–Sunday, whatever day it is', () => {
  assert.deepEqual(weekOf('2026-11-16'), { start: '2026-11-16', end: '2026-11-22' }); // Monday
  assert.deepEqual(weekOf('2026-11-18'), { start: '2026-11-16', end: '2026-11-22' }); // Wednesday
  assert.deepEqual(weekOf('2026-11-22'), { start: '2026-11-16', end: '2026-11-22' }); // Sunday
  assert.deepEqual(weekOf('2026-11-23'), { start: '2026-11-23', end: '2026-11-29' }); // next Monday
});

ok('weekOf: a week that spans two months', () => {
  assert.deepEqual(weekOf('2026-12-01'), { start: '2026-11-30', end: '2026-12-06' });
  assert.equal(weekRangeLabel({ start: '2026-11-16', end: '2026-11-22' }), '16 – 22 Nov');
  assert.equal(weekRangeLabel({ start: '2026-11-30', end: '2026-12-06' }), '30 Nov – 6 Des');
});

ok('a visit cycle counts for this week only when it ends on or before Sunday', () => {
  assert.equal(dueThisWeek('2026-11-22', '2026-11-22'), true); // a 7-day store: the cycle IS this week
  assert.equal(dueThisWeek('2026-11-19', '2026-11-22'), true); // a long cycle closing Thursday
  assert.equal(dueThisWeek('2026-11-23', '2026-11-22'), false); // a long cycle with time to spare
});

// ─── Transfer order phase (shared with the Transfer Order page) ──────────────

console.log('Transfer order phase');

const isWarehouse = (code: string | null | undefined) => !!code && /^dm/i.test(code);
const at = (iso: string) => new Date(`${iso}Z`);
const to = (over: Partial<TransferPhaseInput>): TransferPhaseInput => ({
  fromStoreId: 1,
  toStoreId: 2,
  transferFromCode: 'FF001',
  transferToCode: 'FF002',
  whseShipmentNo: null,
  returnSubmittedAt: null,
  droppingSubmittedAt: null,
  receivedAt: null,
  ...over,
});

ok('waiting for the origin store to hand it over → return', () => {
  assert.equal(resolveTransferPhase(to({}), isWarehouse), 'return');
});

ok('handed to the courier → shipping; store confirmed the goods → receiving; BC posted → received', () => {
  assert.equal(resolveTransferPhase(to({ returnSubmittedAt: at('2026-11-17T08:00:00') }), isWarehouse), 'shipping');
  assert.equal(
    resolveTransferPhase(to({ returnSubmittedAt: at('2026-11-17T08:00:00'), droppingSubmittedAt: at('2026-11-17T12:00:00') }), isWarehouse),
    'receiving',
  );
  assert.equal(
    resolveTransferPhase(to({ droppingSubmittedAt: at('2026-11-17T12:00:00'), receivedAt: at('2026-11-17T13:00:00') }), isWarehouse),
    'received',
  );
});

ok('a warehouse (DM) origin is on the road as soon as BC has made the shipment', () => {
  const dm = to({ fromStoreId: null, transferFromCode: 'DM-JKT' });
  assert.equal(resolveTransferPhase(dm, isWarehouse), 'return'); // no shipment yet
  assert.equal(resolveTransferPhase({ ...dm, whseShipmentNo: 'WS1' }, isWarehouse), 'shipping');
});

ok('a store sending back to a warehouse is "to_warehouse", never listed as on delivery', () => {
  const back = to({ toStoreId: null, transferToCode: 'DM-JKT', returnSubmittedAt: at('2026-11-17T08:00:00') });
  assert.equal(resolveTransferPhase(back, isWarehouse), 'to_warehouse');
});

console.log(`\n${checks} checks passed`);
