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

ok('Item Receiving: a photographed one is timed from the photo, a Selesai Otomatis one from WS Diposting', () => {
  const [b] = buildStoreReports([B], receivingRows, DAYS, 'receiving', NOW);
  assert.equal(b.total, 4);
  assert.equal(b.done, 2);
  // photo 01:00 → WR 04:00 = 180 min; no photo, BC closed it: WS 00:00 → WR 05:00 = 300 min
  assert.equal(b.timed, 2);
  assert.equal(b.auto, 1);
  assert.equal(avgMinutes(b), 240);
  assert.equal(b.notStarted, 1); // the open, unphotographed one still has no clock
  assert.equal(summarise([b]).avgMinutes, 240);
  assert.equal(summarise([b]).timed, 2);
});

ok('the receiving sheet: durations for both finished items, a wait only for the photographed open one', () => {
  const items = buildStoreItems(2, receivingRows, DAYS, 'receiving', opts);
  assert.deepEqual(items.filter((i) => i.minutes != null).map((i) => i.minutes).sort(), [180, 300]);
  assert.equal(items.filter((i) => i.waitingMinutes != null).length, 1);
  const auto = items.find((i) => i.auto)!;
  assert.equal(auto.minutes, 300);
  assert.deepEqual(auto.steps.map((x) => [x.label, x.at != null]), [
    ['WS Diposting', true], ['Terima Fisik Barang di Toko', false], ['WR Diposting · selesai otomatis', true],
  ]);
});

// ── Selesai Otomatis: BC posted the WR while the store never did its PRISM step ──
// The time is kept: BC's time stands in for the missing photo.
const autoReturnRows: ReportRow[] = [
  // photographed: 60 min, a normal finish
  row({ returnDetectedAt: at('2026-11-02T01:00:00'), returnSubmittedAt: at('2026-11-02T02:00:00'), receivedAt: at('2026-11-02T09:00:00') }),
  // never photographed, BC finished it: TO Dibuat 02 Nov 01:00 → WR 04 Nov 09:00 = 56 h
  row({ returnDetectedAt: at('2026-11-02T01:00:00'), receivedAt: at('2026-11-04T09:00:00') }),
];

ok('an Item Return BC finished without the photo is done + auto, timed TO Dibuat → WR Diposting', () => {
  const [a] = buildStoreReports([A], autoReturnRows, DAYS, 'return', NOW);
  assert.equal(a.total, 2);
  assert.equal(a.done, 2);
  assert.equal(a.auto, 1);
  assert.equal(a.timed, 2);
  assert.equal(avgMinutes(a), (60 + 56 * 60) / 2);
  assert.equal(a.oldestOpenMinutes, null); // finished — no longer "waiting"
  assert.equal(summarise([a]).auto, 1);
  const auto = buildStoreItems(1, autoReturnRows, DAYS, 'return', opts).find((i) => i.auto)!;
  assert.equal(auto.done, true);
  assert.equal(auto.minutes, 56 * 60);
  assert.equal(auto.waitingMinutes, null);
  assert.deepEqual(auto.steps.map((x) => [x.label, x.at != null]), [
    ['TO Dibuat', true], ['WS Diposting', false], ['Foto Serah Terima', false], ['WR Diposting · selesai otomatis', true],
  ]);
});

ok('half done (only the destination photographed): the Item Return stops at Terima Fisik, not WR Diposting', () => {
  const rows = [row({
    returnDetectedAt: at('2026-11-02T01:00:00'), droppingDetectedAt: at('2026-11-02T03:00:00'),
    droppingSubmittedAt: at('2026-11-02T09:00:00'), receivedAt: at('2026-11-04T09:00:00'),
  })];
  const [a] = buildStoreReports([A], rows, DAYS, 'return', NOW);
  assert.equal(a.done, 1);
  assert.equal(a.auto, 1);
  assert.equal(avgMinutes(a), 8 * 60); // TO Dibuat 01:00 → Terima Fisik 09:00
  const item = buildStoreItems(1, rows, DAYS, 'return', opts)[0];
  assert.equal(item.steps.at(-1)!.label, 'Terima Fisik di toko tujuan · selesai otomatis');
});

ok('a delivery whose WR is dated before the Foto Serah Terima is done but has no clock — never a 0 in the average', () => {
  const rows = [
    // normal: Foto 02 Nov 02:00 → WR 03 Nov 02:00 = 24 h
    row({ returnDetectedAt: at('2026-11-02T01:00:00'), returnSubmittedAt: at('2026-11-02T02:00:00'), receivedAt: at('2026-11-03T02:00:00') }),
    // backwards: Foto 04 Nov 08:00, but BC posted the WR on 02 Nov
    row({ returnDetectedAt: at('2026-11-02T01:00:00'), returnSubmittedAt: at('2026-11-02T08:00:00'), receivedAt: at('2026-11-02T05:00:00') }),
  ];
  const [b] = buildStoreReports([B], rows, DAYS, 'delivery', NOW);
  assert.equal(b.done, 2);
  assert.equal(b.timed, 1);
  assert.equal(avgMinutes(b), 24 * 60);
});

ok('Item Delivery: origin photographed, destination did not → Foto Serah Terima → WR Diposting', () => {
  const rows = [row({ returnDetectedAt: at('2026-11-02T01:00:00'), returnSubmittedAt: at('2026-11-02T02:00:00'), receivedAt: at('2026-11-03T02:00:00') })];
  const [b] = buildStoreReports([B], rows, DAYS, 'delivery', NOW);
  assert.equal(b.done, 1);
  assert.equal(b.auto, 1);
  assert.equal(b.timed, 1);
  assert.equal(avgMinutes(b), 24 * 60);
});

ok('no photo at all, store → store: Item Delivery AND Item Receiving are both WS Diposting → WR Diposting', () => {
  const rows = [row({
    returnDetectedAt: at('2026-11-02T22:00:00'), droppingDetectedAt: at('2026-11-03T00:00:00'), receivedAt: at('2026-11-03T06:00:00'),
  })];
  const [delivery] = buildStoreReports([B], rows, DAYS, 'delivery', NOW);
  const [receiving] = buildStoreReports([B], rows, DAYS, 'receiving', NOW);
  for (const r of [delivery, receiving]) {
    assert.equal(r.total, 1);
    assert.equal(r.done, 1);
    assert.equal(r.auto, 1);
    assert.equal(avgMinutes(r), 360);
  }
  // still open (no WR yet) and no Foto Serah Terima → no delivery yet
  const open = [row({ droppingDetectedAt: at('2026-11-03T00:00:00') })];
  assert.equal(buildStoreReports([B], open, DAYS, 'delivery', NOW)[0].total, 0);
});

console.log(`\n${checks} checks passed.`);
