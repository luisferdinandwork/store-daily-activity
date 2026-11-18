// scripts/test-ops-dashboard.ts
// Pure-logic checks for the Ops Dashboard — no DB, no BC, no browser.
//   npm run test:ops-dashboard
//
// Covers: which stores "need attention" and in what order (lib/ops-dashboard.ts), the waiting-time
// wording + colour bands and the Monday–Sunday week (lib/ops-dashboard-queues.ts), and the
// transfer-order phase rule the dashboard shares with the Transfer Order page, and which stores the
// Transfer Orders cards list (slower than the month average).

import assert from 'node:assert/strict';

import {
  ATTENTION_LIMIT,
  rateBand,
  storesBehind,
  type DashboardData,
  type StoreAttendanceRow,
  type StoreTaskRow,
} from '../lib/ops-dashboard';
import { dueThisWeek, storesAboveAverage, waitingLabel, waitingMinutes, waitingTone, weekOf, weekRangeLabel } from '../lib/ops-dashboard-queues';
import { legsNotProcessedInPrism, resolveTransferPhase, type TransferPhaseInput } from '../lib/transfer-order-phase';
import { WS_NOT_RECORDED, buildTransferMetrics, minutesBetween, type MetricInput } from '../lib/transfer-order-metrics';

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
    resolveTransferPhase(to({
      returnSubmittedAt: at('2026-11-17T08:00:00'), droppingSubmittedAt: at('2026-11-17T12:00:00'), receivedAt: at('2026-11-17T13:00:00'),
    }), isWarehouse),
    'received',
  );
});

ok('BC posted it while a store leg was never processed in PRISM → auto_completed, naming the leg', () => {
  // Origin never sent Foto Serah Terima.
  const noReturn = to({ droppingSubmittedAt: at('2026-11-17T12:00:00'), receivedAt: at('2026-11-17T13:00:00') });
  assert.equal(resolveTransferPhase(noReturn, isWarehouse), 'auto_completed');
  assert.deepEqual(legsNotProcessedInPrism(noReturn, isWarehouse), ['return']);
  // Nobody processed anything.
  const none = to({ whseShipmentNo: 'WS1', receivedAt: at('2026-11-17T13:00:00') });
  assert.deepEqual(legsNotProcessedInPrism(none, isWarehouse), ['return', 'receiving']);
  // A DM origin has no Item Return to miss — only the store's Terima Fisik.
  const fromDm = to({ fromStoreId: null, transferFromCode: 'DM-JKT', whseShipmentNo: 'WS1', receivedAt: at('2026-11-17T13:00:00') });
  assert.deepEqual(legsNotProcessedInPrism(fromDm, isWarehouse), ['receiving']);
  // Still open → nothing is "missing" yet.
  assert.deepEqual(legsNotProcessedInPrism(to({ whseShipmentNo: 'WS1' }), isWarehouse), []);
});

ok('store → DM: with Foto Serah Terima, the warehouse WR is a normal finish; without it, Selesai Otomatis', () => {
  // The store sent its Foto Serah Terima; the warehouse posted the WR later.
  const back = to({ toStoreId: null, transferToCode: 'DM-JKT', returnSubmittedAt: at('2026-11-17T08:00:00'), receivedAt: at('2026-11-19T16:59:59') });
  assert.equal(resolveTransferPhase(back, isWarehouse), 'received');
  assert.deepEqual(legsNotProcessedInPrism(back, isWarehouse), []);
  // No Foto Serah Terima, but the warehouse posted the WR: nothing was done in PRISM.
  const noPhoto = to({ toStoreId: null, transferToCode: 'DM-JKT', whseShipmentNo: 'WS1', receivedAt: at('2026-11-19T16:59:59') });
  assert.equal(resolveTransferPhase(noPhoto, isWarehouse), 'auto_completed');
  assert.deepEqual(legsNotProcessedInPrism(noPhoto, isWarehouse), ['return']);
});

ok('a warehouse (DM) origin is on the road as soon as BC has made the shipment', () => {
  const dm = to({ fromStoreId: null, transferFromCode: 'DM-JKT' });
  assert.equal(resolveTransferPhase(dm, isWarehouse), 'return'); // no shipment yet
  assert.equal(resolveTransferPhase({ ...dm, whseShipmentNo: 'WS1' }, isWarehouse), 'shipping');
});

ok('a store sending back to a warehouse is "to_warehouse" until the DM posts its WR, never listed as on delivery', () => {
  const back = to({ toStoreId: null, transferToCode: 'DM-JKT', returnSubmittedAt: at('2026-11-17T08:00:00') });
  assert.equal(resolveTransferPhase(back, isWarehouse), 'to_warehouse');
  assert.deepEqual(legsNotProcessedInPrism(back, isWarehouse), []); // still open
});

// ─── Transfer Order page metrics of a Selesai Otomatis order ─────────────────
// The time is kept: a missing photo is replaced by BC's time (start → WS Diposting,
// end → WR Diposting), never a blank.

const metricsOf = (over: Partial<MetricInput>) => {
  const all = buildTransferMetrics({
    returnDetectedAt: null, returnSubmittedAt: null, droppingDetectedAt: null, droppingSubmittedAt: null, receivedAt: null,
    fromIsWarehouse: false, toIsWarehouse: false, ...over,
  });
  return Object.fromEntries(all.map((m) => [m.key, m])) as Record<(typeof all)[number]['key'], (typeof all)[number]>;
};
const TO = '2026-11-17T01:00:00Z';
const WS = '2026-11-17T03:00:00Z';
const WR = '2026-11-18T03:00:00Z';

ok('no photo at all: Delivery and Item Receiving both read WS Diposting → WR Diposting', () => {
  const m = metricsOf({ returnDetectedAt: TO, droppingDetectedAt: WS, receivedAt: WR });
  for (const key of ['delivery', 'bcReceiving'] as const) {
    assert.equal(m[key].start, WS);
    assert.equal(m[key].end, WR);
    assert.equal(m[key].auto, true);
    assert.equal(m[key].skipped, false);
    assert.equal(minutesBetween(m[key].start, m[key].end), 24 * 60);
  }
  // the running Item Return wait stops at WR Diposting instead of disappearing
  assert.equal(m.wsToReturn.start, WS);
  assert.equal(m.wsToReturn.end, WR);
  assert.equal(m.wsToReturn.autoEndLabel, 'WR Diposting');
  // "Total Return" is gone (it only repeated TO → WS + WS → Foto)
  assert.equal('returnTotal' in m, false);
  // TO Dibuat → WS Diposting has no photo in it: untouched, not auto
  assert.equal(m.bcProcessing.auto, false);
  assert.equal(m.bcProcessing.end, WS);
});

ok('photos that exist are kept; only the missing end is filled in', () => {
  const photo = '2026-11-17T05:00:00Z';
  const m = metricsOf({ returnDetectedAt: TO, droppingDetectedAt: WS, returnSubmittedAt: photo, receivedAt: WR });
  assert.equal(m.delivery.start, photo);
  assert.equal(m.delivery.autoStart, false);
  assert.equal(m.delivery.end, WR);
  assert.equal(m.delivery.autoEnd, true);
  assert.equal(m.wsToReturn.end, photo);
  assert.equal(m.wsToReturn.auto, false);
});

ok('half done (only the destination photographed): the Item Return stops at Terima Fisik, not WR Diposting', () => {
  const terima = '2026-11-17T09:00:00Z';
  const m = metricsOf({ returnDetectedAt: TO, droppingDetectedAt: WS, droppingSubmittedAt: terima, receivedAt: WR });
  assert.equal(m.wsToReturn.end, terima);
  assert.equal(m.wsToReturn.autoEndLabel, 'Terima Fisik');
  assert.equal(minutesBetween(m.wsToReturn.start, m.wsToReturn.end), 6 * 60);
  // Delivery: WS Diposting (no Foto Serah Terima) → Terima Fisik; Item Receiving untouched
  assert.equal(m.delivery.start, WS);
  assert.equal(m.delivery.end, terima);
  assert.equal(m.delivery.autoEnd, false);
  assert.equal(m.bcReceiving.start, terima);
  assert.equal(m.bcReceiving.auto, false);
});

ok('an order still open is not filled in; a fully photographed one is not auto', () => {
  const open = metricsOf({ returnDetectedAt: TO, droppingDetectedAt: WS });
  assert.equal(open.delivery.start, null);
  assert.equal(open.bcReceiving.auto, false);
  const done = metricsOf({
    returnDetectedAt: TO, droppingDetectedAt: WS, returnSubmittedAt: '2026-11-17T05:00:00Z', droppingSubmittedAt: '2026-11-17T09:00:00Z', receivedAt: WR,
  });
  assert.equal(Object.values(done).some((x) => x.auto || x.skipped), false);
});

ok('finished with no WS ever recorded (TOA26013717): every WS metric says why, and a WR before the photo is not "0m"', () => {
  // TO Dibuat 14 Okt, BC posted the WR 16 Okt, the origin only sent its Foto Serah Terima 19 Okt; no WS.
  const m = metricsOf({
    returnDetectedAt: '2026-10-14T02:32:59Z', returnSubmittedAt: '2026-10-19T08:48:59Z', receivedAt: '2026-10-16T16:59:59Z',
  });
  for (const key of ['bcProcessing', 'wsToReturn', 'bcReceiving'] as const) {
    assert.equal(m[key].skipped, true, key);
    assert.equal(m[key].skippedLabel, WS_NOT_RECORDED, key);
  }
  // Delivery = Foto Serah Terima (19 Okt) → WR Diposting (16 Okt): backwards — no duration, says why.
  assert.equal(m.delivery.skipped, true);
  assert.equal(m.delivery.skippedLabel, 'tidak tercatat — WR Diposting lebih awal dari Foto Serah Terima');
});

// ─── Transfer Orders cards: stores slower than the month average ─────────────

ok('the month average pools every completed process; only stores above it are listed, slowest first', () => {
  const reports = [
    { id: 1, minutes: 600, timed: 2 },  // avg 300
    { id: 2, minutes: 100, timed: 1 },  // avg 100
    { id: 3, minutes: 0, timed: 0 },    // nothing finished — no average, never listed
    { id: 4, minutes: 1200, timed: 3 }, // avg 400
  ];
  // pooled: (600 + 100 + 1200) / 6 = 316.67 — NOT the mean of the store averages (266.67)
  const r = storesAboveAverage(reports);
  assert.equal(r.monthAvgMinutes, 317);
  assert.equal(r.timed, 6);
  assert.deepEqual(r.above.map((x) => [x.report.id, x.avgMinutes]), [[4, 400]]);
  assert.deepEqual(storesAboveAverage([{ minutes: 0, timed: 0 }]), { monthAvgMinutes: null, timed: 0, above: [] });
});

console.log(`\n${checks} checks passed`);
