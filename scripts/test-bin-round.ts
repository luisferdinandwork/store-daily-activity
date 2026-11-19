// scripts/test-bin-round.ts
// Pure-logic checks for the monthly Cek Bin round (lib/bin-round.ts) — no DB, no BC.
//   npm run test:bin-round
//
// Covers: the daily pick (20 bins, deterministic per store + day, never-offered first, walking order, excluded
// bins), a month played day by day never hands out a checked bin and covers every bin, folding BC's scans into a
// bin's result (first check = result, later right scan = fixed), the BC bin list grouping and the month helpers.

import assert from 'node:assert/strict';

import {
  DAILY_BIN_COUNT,
  EXCLUDED_BINS_TEXT,
  accuracyPct,
  collectBinChecks,
  compareBinCodes,
  daysToFinish,
  foldBinChecks,
  isExcludedBin,
  isFixed,
  isMonthFinal,
  monthBounds,
  pickDailyBins,
  progressPct,
  roundSeed,
  shiftYearMonth,
  storePhase,
  type PoolBin,
} from '../lib/bin-round';
import { groupBinListRows } from '../lib/bc/bin-round';

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

const binCodes = (n: number) => Array.from({ length: n }, (_, i) => `GDM${1 + Math.floor(i / 26)}${String.fromCharCode(65 + (i % 26))}${1 + (i % 4)}`);
const pool = (codes: string[], times = 0): PoolBin[] => codes.map((binCode) => ({ binCode, timesAssigned: times }));

console.log('Daily pick');

ok('20 bins, sorted in walking order, no duplicates', () => {
  const picked = pickDailyBins(pool(binCodes(300)), roundSeed(1, '2026-11-19'));
  assert.equal(picked.length, DAILY_BIN_COUNT);
  assert.equal(new Set(picked).size, DAILY_BIN_COUNT);
  assert.deepEqual(picked, [...picked].sort(compareBinCodes));
});

ok('same store + day + pool → same list; another day or store → another list', () => {
  const p = pool(binCodes(300));
  const a = pickDailyBins(p, roundSeed(1, '2026-11-19'));
  assert.deepEqual(pickDailyBins([...p].reverse(), roundSeed(1, '2026-11-19')), a, 'DB row order must not matter');
  assert.notDeepEqual(pickDailyBins(p, roundSeed(1, '2026-11-20')), a);
  assert.notDeepEqual(pickDailyBins(p, roundSeed(2, '2026-11-19')), a);
});

ok('random, not the first 20 in code order', () => {
  const codes = binCodes(300).sort(compareBinCodes);
  const picked = pickDailyBins(pool(codes), roundSeed(7, '2026-11-03'));
  assert.notDeepEqual(picked, codes.slice(0, 20));
});

ok('bins never offered come before bins offered already (least offered first)', () => {
  const fresh = ['A1', 'A2', 'A3'];
  const once = binCodes(40).map((binCode) => ({ binCode, timesAssigned: 1 }));
  const twice = ['Z1', 'Z2'].map((binCode) => ({ binCode, timesAssigned: 2 }));
  const picked = pickDailyBins([...twice, ...once, ...pool(fresh)], roundSeed(3, '2026-11-05'));
  for (const f of fresh) assert.ok(picked.includes(f), `${f} must be picked`);
  assert.ok(!picked.includes('Z1') && !picked.includes('Z2'), 'twice-offered bins wait while once-offered remain');
});

ok('fewer pending bins than 20 → all of them; none → empty', () => {
  assert.deepEqual(pickDailyBins(pool(['B2', 'B10', 'B1']), 's'), ['B1', 'B2', 'B10']);
  assert.deepEqual(pickDailyBins([], 's'), []);
});

ok(`excluded bins (${EXCLUDED_BINS_TEXT}) are never handed out`, () => {
  const picked = pickDailyBins(
    pool(['booking', 'DISPLAY', 'RECEIVING', 'DISPLAY-A1', 'display-h4', 'DISPLAY-5', 'SHIPPING', 'DEFECT', 'GDM1A1']),
    's',
  );
  assert.deepEqual(picked, ['BOOKING', 'DEFECT', 'DISPLAY-5', 'DISPLAY-A1', 'DISPLAY-H4', 'GDM1A1', 'RECEIVING', 'SHIPPING']);
});

ok('only the bin coded exactly DISPLAY is excluded; DISPLAY-xx, BOOKING, RECEIVING, SHIPPING are checked', () => {
  for (const code of ['DISPLAY', ' display ']) assert.ok(isExcludedBin(code), `${code} must be excluded`);
  for (const code of ['DISPLAY-1', 'DISPLAY-A1', 'DISPLAY-H4', 'XDISPLAY', 'DISPLAY2', 'BOOKING', 'RECEIVING', 'SHIPPING', 'DEFECT', 'GDM1A1', '']) {
    assert.ok(!isExcludedBin(code), `${code} must stay in the round`);
  }
});

ok('a month day by day: a checked bin never comes back, every bin is covered', () => {
  const codes = binCodes(318);
  const state = new Map(codes.map((c) => [c, { checked: false, times: 0 }]));
  const seenChecked = new Set<string>();
  let days = 0;
  for (let d = 1; d <= 31; d++) {
    const day = `2026-11-${String(d).padStart(2, '0')}`;
    const pending = [...state.entries()].filter(([, s]) => !s.checked).map(([binCode, s]) => ({ binCode, timesAssigned: s.times }));
    const list = pickDailyBins(pending, roundSeed(1, day));
    if (!list.length) break;
    days += 1;
    list.forEach((code, i) => {
      assert.ok(!seenChecked.has(code), `${code} was checked already but came back on ${day}`);
      const s = state.get(code)!;
      s.times += 1;
      // The store skips the last two bins of every full list.
      if (list.length < DAILY_BIN_COUNT || i < list.length - 2) {
        s.checked = true;
        seenChecked.add(code);
      }
    });
  }
  assert.ok([...state.values()].every((s) => s.checked), 'every bin checked by the end of the month');
  assert.ok(days <= 31 && days >= Math.ceil(318 / DAILY_BIN_COUNT));
});

console.log('BC results');

const line = (status: string, itemNo = 'ITEM1', extra: Record<string, unknown> = {}) => ({
  itemNo,
  variantCode: 'M',
  unitOfMeasureCode: 'PCS',
  scanQuantity: 1,
  binQuantity: 1,
  binContentCheckStatus: status,
  ...extra,
});
const header = (date: string, binCode: string, lines: unknown[], extra: Record<string, unknown> = {}) => ({
  location: 'FF001',
  date,
  binCode,
  checked: true,
  ppBinContentCheckLines: lines,
  ...extra,
});

ok('a bin is wrong when one line is; unchecked headers and other days are ignored', () => {
  const checks = collectBinChecks(
    [
      header('2026-11-02', 'gdm1a1', [line('Matched'), line('Qty_x0020_Lower_x0020_Than_x0020_Bin', 'ITEM2', { scanQuantity: 1, binQuantity: 3 })]),
      header('2026-11-02', 'GDM1A2', [line(' ')]),
      header('2026-11-05', 'GDM1A3', [line('Not Found')], { checked: false }),
      header('2026-10-31', 'GDM1A4', [line('Misplaced')]),
      header('2026-11-02', 'GDM1A5', []),
    ],
    '2026-11-01',
    '2026-11-19',
  );
  const ff = checks.get('FF001')!;
  assert.equal(ff.get('GDM1A1')![0].wrong, true);
  assert.equal(ff.get('GDM1A1')![0].wrongLines[0].reason, 'qty_lower');
  assert.equal(ff.get('GDM1A2')![0].wrong, false);
  assert.equal(ff.get('GDM1A5')![0].wrong, false, 'a scanned bin with no lines is right');
  assert.ok(!ff.has('GDM1A3') && !ff.has('GDM1A4'));
});

ok('first check is the result; a right scan later = fixed', () => {
  const checks = collectBinChecks(
    [
      header('2026-11-10', 'GDM1B1', [line('Matched')]),
      header('2026-11-02', 'GDM1B1', [line('Misplaced', 'ITEM9', { actualBinCodes: 'GDM2A1|GDM2A2' })]),
      header('2026-11-02', 'GDM1B1', [line('Misplaced', 'ITEM9')]), // same day, second header: one check
    ],
    '2026-11-01',
    '2026-11-19',
  ).get('FF001')!.get('GDM1B1')!;
  assert.equal(checks.length, 2);
  const f = foldBinChecks(checks)!;
  assert.equal(f.status, 'wrong');
  assert.equal(f.firstCheckedOn, '2026-11-02');
  assert.equal(f.firstWrongCount, 1, 'the duplicate line is counted once');
  assert.deepEqual(f.wrongLines[0].actualBinCodes, ['GDM2A1', 'GDM2A2']);
  assert.equal(f.lastResult, 'correct');
  assert.equal(f.checkDays, 2);
  assert.ok(isFixed({ status: f.status, lastResult: f.lastResult, firstCheckedOn: f.firstCheckedOn, lastCheckedOn: f.lastCheckedOn }));
});

ok('BC bin list rows → one entry per bin with item lines + quantity', () => {
  const bins = groupBinListRows([
    { binCode: 'GDM1A2', quantityBase: 2 },
    { binCode: 'gdm1a2 ', quantityBase: 0 },
    { binCode: 'GDM1A10', quantityBase: 1.6 },
    { binCode: '', quantityBase: 4 },
    null,
  ]);
  assert.deepEqual(bins, [
    { binCode: 'GDM1A2', itemLines: 2, quantity: 2 },
    { binCode: 'GDM1A10', itemLines: 1, quantity: 2 },
  ]);
});

console.log('Month');

ok('month bounds, shifting, freezing', () => {
  assert.deepEqual(monthBounds('2026-11', '2026-11-19'), { from: '2026-11-01', to: '2026-11-19' });
  assert.deepEqual(monthBounds('2026-10', '2026-11-19'), { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(monthBounds('2026-12', '2026-11-19'), null);
  assert.equal(shiftYearMonth('2026-01', -1), '2025-12');
  assert.equal(shiftYearMonth('2026-12', 1), '2027-01');
  assert.equal(isMonthFinal('2026-10', '2026-11-01'), false, 'one day of grace for late BC postings');
  assert.equal(isMonthFinal('2026-10', '2026-11-02'), true);
});

ok('stats: progress, accuracy, days left, phase', () => {
  const s = { totalBins: 318, checkedBins: 100, correctBins: 90, wrongBins: 10, fixedBins: 4 };
  assert.equal(Math.round(progressPct(s)!), 31);
  assert.equal(accuracyPct(s), 90);
  assert.equal(daysToFinish(218), 11);
  assert.equal(storePhase({ stats: s }), 'running');
  assert.equal(storePhase({ stats: { ...s, checkedBins: 318 } }), 'done');
  assert.equal(storePhase({ stats: null }), 'no_list');
  assert.equal(accuracyPct({ correctBins: 0, wrongBins: 0 }), null);
});

console.log(`\n${checks} checks passed.`);
