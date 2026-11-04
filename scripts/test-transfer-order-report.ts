// scripts/test-transfer-order-report.ts
// Pure-logic checks for the TO Report (lib/transfer-order-report.ts) — no DB, no BC.
//   npm run test:transfer-report
//
// The rule under test: an AVERAGE (the KPI tile, a store's row, the store sheet) is made
// of COMPLETED processes only. An open one — even one that has waited for days — must
// never move it; it only feeds "Menunggu terlama".

import assert from 'node:assert/strict';

import {
  buildStoreItems,
  buildStoreReports,
  avgMinutes,
  summarise,
  type ReportRow,
  type StoreMeta,
} from '../lib/transfer-order-report';

const store = (id: number, name: string): StoreMeta => ({ id, name, storeNo: `FF00${id}`, areaId: '1', areaName: 'DKI' });
const A = store(1, 'Toko A');
const B = store(2, 'Toko B');
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04'];
const NOW = new Date('2026-11-04T10:00:00Z');

const at = (iso: string) => new Date(`${iso}Z`);
let nextId = 1;

function row(over: Partial<ReportRow>): ReportRow {
  return {
    id: nextId++, toaNo: `TOA${nextId}`, transferFromCode: 'FF001', transferToCode: 'FF002',
    fromStoreId: 1, toStoreId: 2, qtyOrdered: 5, whseShipmentNo: 'WS1',
    returnDetectedAt: null, returnSubmittedAt: null, droppingDetectedAt: null, droppingSubmittedAt: null, receivedAt: null,
    ...over,
  };
}

const opts = { now: NOW, nameByCode: new Map<string, string>(), isWarehouseCode: () => false };
let checks = 0;
const ok = (name: string, fn: () => void) => { fn(); checks += 1; console.log(`  ✓ ${name}`); };

// ── Item Return: TO Dibuat → Foto Serah Terima ───────────────────────────────
// Toko A: two done (60 min + 120 min) and one open for 2 days.
const returnRows: ReportRow[] = [
  row({ returnDetectedAt: at('2026-11-02T01:00:00'), returnSubmittedAt: at('2026-11-02T02:00:00') }),
  row({ returnDetectedAt: at('2026-11-03T01:00:00'), returnSubmittedAt: at('2026-11-03T03:00:00') }),
  row({ returnDetectedAt: at('2026-11-02T08:00:00') }), // still open: waiting since D-2
];

ok('Item Return average ignores the open process', () => {
  const [a] = buildStoreReports([A], returnRows, DAYS, 'return', NOW);
  assert.equal(a.total, 3);
  assert.equal(a.done, 2);
  assert.equal(a.timed, 2);
  assert.equal(avgMinutes(a), 90); // (60 + 120) / 2 — the open one would have dragged it up
  // …but it is what "Menunggu terlama" reports: 02 Nov 08:00 → 04 Nov 10:00 = 2 days 2 h
  assert.equal(a.oldestOpenMinutes, 48 * 60 + 2 * 60);
});

ok('KPI totals use the same completed-only mean and say how many it covers', () => {
  const reports = buildStoreReports([A, B], returnRows, DAYS, 'return', NOW);
  const t = summarise(reports);
  assert.equal(t.avgMinutes, 90);
  assert.equal(t.timed, 2);
  assert.equal(t.done, 2);
  assert.equal(t.open, 1);
});

ok('a store with only open processes has no average at all', () => {
  const onlyOpen = [row({ returnDetectedAt: at('2026-11-02T01:00:00') })];
  const [a] = buildStoreReports([A], onlyOpen, DAYS, 'return', NOW);
  assert.equal(avgMinutes(a), null);
  assert.equal(summarise([a]).avgMinutes, null);
  assert.equal(summarise([a]).timed, 0);
});

ok('the sheet gives a duration to completed items only; open ones carry a separate wait', () => {
  const items = buildStoreItems(1, returnRows, DAYS, 'return', opts);
  const done = items.filter((i) => i.done);
  const open = items.filter((i) => !i.done);
  assert.deepEqual(done.map((i) => i.minutes ?? 0).sort((x, y) => x - y), [60, 120]);
  assert.ok(open.every((i) => i.minutes === null && i.waitingMinutes != null));
  assert.ok(done.every((i) => i.waitingMinutes === null));
  // The sheet's own average (mean of the done items' minutes) equals the row's.
  const [a] = buildStoreReports([A], returnRows, DAYS, 'return', NOW);
  const sheetAvg = Math.round(done.reduce((s, i) => s + (i.minutes ?? 0), 0) / done.length);
  assert.equal(sheetAvg, avgMinutes(a));
});

// ── Item Receiving: Terima Fisik → WR Diposting, divided by `timed`, not `done` ──
const receivingRows: ReportRow[] = [
  // done, timed: photo 01:00 → WR 04:00 = 180 min
  row({ droppingDetectedAt: at('2026-11-03T00:00:00'), droppingSubmittedAt: at('2026-11-03T01:00:00'), receivedAt: at('2026-11-03T04:00:00') }),
  // done but BC closed it with no store photo: counts as done, has no duration
  row({ droppingDetectedAt: at('2026-11-03T00:00:00'), receivedAt: at('2026-11-03T05:00:00') }),
  // open, photographed: running clock (a wait, not an average input)
  row({ droppingDetectedAt: at('2026-11-02T00:00:00'), droppingSubmittedAt: at('2026-11-02T01:00:00') }),
  // open, not photographed yet: no clock at all
  row({ droppingDetectedAt: at('2026-11-04T00:00:00') }),
];

ok('Item Receiving divides by timed, not done, and leaves open ones out', () => {
  const [b] = buildStoreReports([B], receivingRows, DAYS, 'receiving', NOW);
  assert.equal(b.total, 4);
  assert.equal(b.done, 2);
  assert.equal(b.timed, 1);
  assert.equal(avgMinutes(b), 180);
  assert.equal(b.notStarted, 1);
  assert.equal(summarise([b]).avgMinutes, 180);
  assert.equal(summarise([b]).timed, 1);
});

ok('the receiving sheet: no duration for the unphotographed or the no-photo-closed item', () => {
  const items = buildStoreItems(2, receivingRows, DAYS, 'receiving', opts);
  const withMinutes = items.filter((i) => i.minutes != null);
  assert.equal(withMinutes.length, 1);
  assert.equal(withMinutes[0].minutes, 180);
  assert.equal(items.filter((i) => i.waitingMinutes != null).length, 1); // the photographed open one
});

console.log(`\n${checks} checks passed.`);
