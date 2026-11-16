// scripts/test-audit-stock-opname.ts
// Pure-logic checks for the Audit "Hasil Cek Bin" report (lib/audit-bin-report.ts) and the Stock Opname rules
// (lib/audit-stock-opname.ts) — no DB, no BC.
//   npm run test:audit-so
//
// Rows are shaped like real BC answers (ppBinContentCheckHeaders + ppBinContentCheckLines, UAT FF001 2026-11-10):
// statuses "Matched", "_x0020_", "Not_x0020_Scanned", "Misplaced", "Qty_x0020_Lower/Higher_x0020_Than_x0020_Bin".

import assert from 'node:assert/strict';

import {
  binTotals,
  formatAccuracy,
  formatAvg,
  groupByDay,
  groupByStore,
  periodDays,
  periodProblem,
  sortStoreGroups,
  summarizeBinCheckHeaders,
  type BinReportRow,
} from '../lib/audit-bin-report';
import {
  brandOfStore,
  cleanFindings,
  defaultStoreTitle,
  diffSide,
  idNumber,
  linePrice,
  locationOfStore,
  shortDateId,
  soTotals,
  suggestFromBc,
  summarizeSoLines,
  titleCase,
  toValue,
  totalHargaText,
  type SoBcSnapshot,
} from '../lib/audit-stock-opname';
import {
  DURATION_LABEL,
  INCENTIVE_LABEL,
  addMonthsDay,
  autoDuration,
  autoReward,
  cleanRewardRows,
  newRewardRow,
  resolveReward,
  rewardRoleLabels,
  rewardTitle,
  sheetDate,
  sortRewardRows,
  summarizeReward,
} from '../lib/audit-super-reward';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const line = (bin: string, item: string, variant: string, scan: number, inBin: number, status: string, extra: Record<string, unknown> = {}) => ({
  date: '2026-11-10',
  location: 'FF001',
  binCode: bin,
  itemNo: item,
  variantCode: variant,
  unitOfMeasureCode: 'PCS',
  actualBinCodes: bin,
  scanQuantity: scan,
  binQuantity: inBin,
  binContentCheckStatus: status,
  ...extra,
});

const header = (bin: string, date: string, location: string, checked: boolean, lines: unknown[]) => ({
  date,
  location,
  binCode: bin,
  checked,
  ppBinContentCheckLines: lines,
});

// ─── Hasil Cek Bin ───────────────────────────────────────────────────────────

console.log('Hasil Cek Bin');

const RANGE = [
  header('GDM1A1', '2026-11-10', 'FF001', true, [
    line('GDM1A1', 'A', 'M', 1, 1, 'Matched'),
    line('GDM1A1', 'A', 'L', 0, 1, 'Not_x0020_Scanned'),
    line('GDM1A1', 'B', 'S', 1, 2, 'Qty_x0020_Lower_x0020_Than_x0020_Bin'),
  ]),
  header('GDM1B1', '2026-11-10', 'FF001', true, [line('GDM1B1', 'C', '', 2, 2, '_x0020_'), line('GDM1B1', 'D', '', 1, 0, 'Misplaced')]),
  header('GDM9Z9', '2026-11-10', 'FF001', false, [line('GDM9Z9', 'E', '', 0, 5, 'Not_x0020_Scanned')]), // not scanned → ignored
  header('X1', '2026-11-12', 'ff001', true, [line('X1', 'F', '', 3, 3, 'Matched')]),
  header('X1', '2026-11-12', 'FO001', true, [line('X1', 'G', '', 0, 1, 'Not_x0020_Found')]),
  header('X1', '2026-10-30', 'FF001', true, [line('X1', 'H', '', 1, 1, 'Matched')]), // outside the range
];

const stats = summarizeBinCheckHeaders(RANGE, '2026-11-01', '2026-11-16');

check('one stat per store + day, newest first, out-of-range and unchecked bins dropped', () => {
  assert.deepEqual(
    stats.map((s) => `${s.date} ${s.location} bins=${s.bins} ok=${s.correct} wrong=${s.wrong}`),
    ['2026-11-12 FF001 bins=1 ok=1 wrong=0', '2026-11-12 FO001 bins=1 ok=0 wrong=1', '2026-11-10 FF001 bins=2 ok=2 wrong=3'],
  );
});

check('totals: averages per store-day with a result, accuracy = right ÷ all', () => {
  const t = binTotals(stats);
  assert.equal(t.storeDays, 3);
  assert.equal(t.days, 2);
  assert.equal(t.stores, 2);
  assert.equal(t.correct, 3);
  assert.equal(t.wrong, 4);
  assert.equal(t.avgCorrect, 1);
  assert.equal(t.avgWrong, 4 / 3);
  assert.equal(Math.round((t.accuracy ?? 0) * 10) / 10, 42.9);
  assert.equal(binTotals([]).accuracy, null);
  assert.equal(binTotals([]).avgCorrect, null);
});

check('period: inclusive days, ≤ 31, not in the future', () => {
  assert.equal(periodDays('2026-11-01', '2026-11-03').join(','), '2026-11-01,2026-11-02,2026-11-03');
  assert.equal(periodDays('2026-10-01', '2026-10-31').length, 31);
  assert.equal(periodDays('2026-10-01', '2026-11-01').length, 0);
  assert.equal(periodProblem('2026-10-01', '2026-10-31', '2026-11-16'), null);
  assert.match(periodProblem('2026-10-01', '2026-11-01', '2026-11-16') ?? '', /maksimal 31/);
  assert.match(periodProblem('2026-11-10', '2026-11-01', '2026-11-16') ?? '', /sebelum/);
  assert.match(periodProblem('2026-11-10', '2026-11-17', '2026-11-16') ?? '', /hari ini/);
});

const joined: BinReportRow[] = stats.map((s) => ({
  ...s,
  storeId: s.location === 'FF001' ? 1 : 2,
  storeName: s.location,
  areaId: 1,
  areaName: 'DKI',
}));
const STORES = [
  { id: 1, storeNo: 'FF001', name: 'FF', areaId: 1, areaName: 'DKI' },
  { id: 2, storeNo: 'FO001', name: 'FO', areaId: 1, areaName: 'DKI' },
  { id: 3, storeNo: 'FS020', name: 'FS', areaId: 2, areaName: 'Medan' },
];

check('per day keeps empty days; per store keeps stores without a check, last', () => {
  const days = groupByDay(joined, periodDays('2026-11-10', '2026-11-12'));
  assert.deepEqual(days.map((d) => `${d.date}:${d.rows.length}`), ['2026-11-12:2', '2026-11-11:0', '2026-11-10:1']);
  const stores = sortStoreGroups(groupByStore(joined, STORES), 'accuracy_asc');
  assert.deepEqual(stores.map((g) => g.store.storeNo), ['FO001', 'FF001', 'FS020']);
  assert.equal(stores[2].totals.storeDays, 0);
});

check('formats', () => {
  assert.equal(formatAvg(4 / 3), '1,3');
  assert.equal(formatAvg(2), '2');
  assert.equal(formatAvg(null), '—');
  assert.equal(formatAccuracy(100), '100%');
  assert.equal(formatAccuracy(42.857), '42,9%');
});

// ─── Stock Opname ────────────────────────────────────────────────────────────

console.log('Stock Opname');

const SO_HEADERS = [
  header('B1', '2026-11-10', 'FF001', true, [
    line('B1', 'SPE1', 'M', 2, 2, 'Matched'),
    line('B1', 'SPE2', 'L', 0, 3, 'Not_x0020_Scanned'),
    line('B1', 'SPE3', 'S', 1, 0, 'Misplaced'), // belongs in B2
  ]),
  header('B2', '2026-11-10', 'FF001', true, [
    line('B2', 'SPE3', 'S', 0, 1, 'Not_x0020_Scanned'), // the misplaced one: per SKU it nets to 0
    line('B2', 'SPE4', '', 5, 4, 'Qty_x0020_Higher_x0020_Than_x0020_Bin'),
  ]),
  header('B3', '2026-11-10', 'FF001', true, [line('B3', 'SPE5', '', 1, 1, '_x0020_')]),
  header('B4', '2026-11-10', 'FF001', false, []),
  header('B5', '2026-11-10', 'FO001', true, [line('B5', 'X', '', 9, 0, 'Misplaced')]), // other store → ignored
];

check('SO lines: bins, quantities, per-SKU plus / minus (a misplaced item nets out)', () => {
  const s = summarizeSoLines(SO_HEADERS, 'FF001', '2026-11-10');
  assert.equal(s.checkedBins, 3);
  assert.equal(s.uncheckedBins, 1);
  assert.equal(s.lines, 6);
  assert.equal(s.correctLines, 2);
  assert.equal(s.wrongLines, 4);
  assert.equal(s.binQty, 11);
  assert.equal(s.scanQty, 9);
  assert.equal(s.plusQty, 1); // SPE4 +1
  assert.equal(s.minusQty, 3); // SPE2 −3 (SPE3 nets to 0)
  assert.equal(s.diffSkus, 2);
  assert.equal(s.binsMatch, 1); // B3
  assert.equal(s.binsMismatch, 2);
  assert.equal(s.plusValue, null); // BC sends no price yet
  assert.equal(s.priceField, null);
});

check('SO lines: a price on the line (when BC adds it) values the differences', () => {
  const priced = SO_HEADERS.map((h) => ({
    ...h,
    ppBinContentCheckLines: h.ppBinContentCheckLines.map((l) => {
      const row = l as Record<string, unknown>;
      return { ...row, unitPrice: row.itemNo === 'SPE2' ? 150_000 : 99_000 };
    }),
  }));
  const s = summarizeSoLines(priced, 'FF001', '2026-11-10');
  assert.equal(s.priceField, 'unitPrice');
  assert.equal(s.pricedDiffSkus, 2);
  assert.equal(s.plusValue, 99_000);
  assert.equal(s.minusValue, 450_000);
  assert.deepEqual(linePrice({ price: '12000' }), { field: 'price', price: 12000 });
  assert.equal(linePrice({ unitPrice: 0 }), null);
});

check('suggestion: SOH = Σ bin qty, scan = Σ scan, total bins = max(bins with stock, scanned)', () => {
  const base = summarizeSoLines(SO_HEADERS, 'FF001', '2026-11-10');
  const snap: SoBcSnapshot = { ...base, state: 'ok', fetchedAt: null, storeBinsState: 'ok', storeBins: 318, storeQty: 12989, salesQty: 17 };
  const s = suggestFromBc(snap);
  assert.deepEqual(
    [s.sohBc, s.scanQty, s.shoppingBagQty, s.transSalesQty, s.binsTotal, s.binsMatch, s.binsMismatch],
    [11, 9, 0, 17, 318, 1, 2],
  );
  assert.equal(suggestFromBc({ ...snap, storeBins: null }).binsTotal, 3);
  assert.equal(suggestFromBc(null).sohBc, 0);
});

check('totals follow the BA sheet: TOTAL = SUM, SELISIH = G14 − E14, Rp = H19 + H20', () => {
  // The sample BA (FS020, 16 Sep 2026): SOH 6.227 vs 4.783 + 1.427 + 17 → selisih 0.
  const t = soTotals({ sohBc: 6227, scanQty: 4783, shoppingBagQty: 1427, transSalesQty: 17, valuePlus: null, valueMinus: null });
  assert.deepEqual([t.bcTotal, t.scanTotal, t.qtyDiff, t.valueTotal], [6227, 6227, 0, null]);
  const u = soTotals({ sohBc: 100, scanQty: 95, shoppingBagQty: 0, transSalesQty: 2, valuePlus: 50_000, valueMinus: 300_000 });
  assert.deepEqual([u.qtyDiff, u.valuePlus, u.valueMinus, u.valueTotal], [-3, 50_000, -300_000, -250_000]);
  assert.equal(totalHargaText(null), 'Total Harga Selisih Barang Plus / Minus = -');
  assert.equal(totalHargaText(-250_000), 'Total Harga Selisih Barang Plus / Minus = -Rp 250.000');
  assert.equal(diffSide(-3), 'minus');
  assert.equal(diffSide(0), null);
});

check('store texts: brand from the code, location + title from the name', () => {
  assert.equal(brandOfStore('FS020'), 'FS');
  assert.equal(brandOfStore('OD002'), 'OD');
  assert.equal(brandOfStore('DUMMY-001'), '');
  assert.equal(locationOfStore('Fisik Sport - Plaza Medan Fair'), 'PLAZA MEDAN FAIR');
  assert.equal(locationOfStore('Factory Outlet-Daan Mogot'), 'DAAN MOGOT');
  assert.equal(defaultStoreTitle('Fisik Sport - Plaza Medan Fair'), 'FISIK SPORT PLAZA MEDAN FAIR');
  assert.equal(titleCase('FISIK PLAZA MEDAN FAIR'), 'Fisik Plaza Medan Fair');
  assert.equal(titleCase('MEDAN'), 'Medan');
});

check('input clean-up + paper formats', () => {
  assert.equal(toValue(''), null);
  assert.equal(toValue('1250000'), 1_250_000);
  assert.equal(toValue(-5), null);
  assert.deepEqual(cleanFindings(['  a  b ', '', 7, 'c']), ['a b', 'c']);
  assert.equal(idNumber(6227), '6.227');
  assert.equal(shortDateId('2026-09-16'), '16 Sept 2026');
});

// ─── Super Reward ────────────────────────────────────────────────────────────

console.log('\nSuper Reward');

const person = (userId: string | null, name: string, type: 'pic_1' | 'pic_2' | 'sa' | null) => ({ userId, nik: `N-${name}`, name, type });

check('the five rows of the sample sheet (FS020, SO 16 Sep 2026) come out as the sheet has them', () => {
  const so = '2026-09-16';
  const rows = [
    { ...newRewardRow(person('u1', 'Sari', 'pic_1'), so), joinDate: '2026-01-01' },
    { ...newRewardRow(person('u2', 'Shalsa', 'pic_2'), so), joinDate: '2024-12-31', soDates: ['2025-10-08', so, null] },
    { ...newRewardRow(person('u3', 'Gilang', 'sa'), so), joinDate: '2025-11-21' },
    { ...newRewardRow(person('u4', 'Rizki', 'sa'), so), joinDate: '2025-12-09' },
    { ...newRewardRow(person('u5', 'Laura', 'sa'), so), joinDate: '2026-09-01' },
  ];
  const got = rows.map((r) => {
    const x = resolveReward(r, so);
    return [x.duration && DURATION_LABEL[x.duration], x.soCount, x.incentive && INCENTIVE_LABEL[x.incentive], x.reward];
  });
  assert.deepEqual(got, [
    ['> 3 BULAN', 1, 'Dapat Regular Reward', 'voucher_300'],
    ['> 3 BULAN', 2, 'Dapat Regular Reward', 'voucher_500'],
    ['> 3 BULAN', 1, 'Dapat Regular Reward', 'voucher_300'],
    ['> 3 BULAN', 1, 'Dapat Regular Reward', 'voucher_300'],
    ['< 3 BULAN', 1, 'Tidak Dapat Regular Reward', 'none'],
  ]);
  assert.deepEqual(rewardRoleLabels(rows), ['PIC 1', 'PIC 2', 'SA 1', 'SA 2', 'SA 3']);
  const s = summarizeReward(rows, so);
  assert.deepEqual([s.employees, s.dapat, s.tidak, s.open, s.voucher, s.cash], [5, 4, 1, 0, 1_400_000, 0]);
});

check('rules: 3 calendar months (month-end clamped), tiers by Jumlah SO, overrides feed the next rule', () => {
  assert.equal(addMonthsDay('2025-11-30', 3), '2026-02-28');
  assert.equal(addMonthsDay('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsDay('2025-12-15', 3), '2026-03-15');
  assert.equal(autoDuration('2026-06-16', '2026-09-16'), 'over');
  assert.equal(autoDuration('2026-06-17', '2026-09-16'), 'under');
  assert.equal(autoDuration(null, '2026-09-16'), null);
  assert.equal(autoReward('dapat', 3), 'cash_500');
  assert.equal(autoReward('dapat', 0), 'none');
  assert.equal(autoReward(null, 2), null);
  const base = { ...newRewardRow(person('u', 'X', 'sa'), '2026-09-16'), joinDate: '2026-09-01' };
  // No Tgl Masuk → nothing decided.
  const open = resolveReward({ ...base, joinDate: null }, '2026-09-16');
  assert.deepEqual([open.duration, open.incentive, open.reward], [null, null, null]);
  // Ket Durasi picked by hand → Keterangan and the reward follow it.
  const forced = resolveReward({ ...base, duration: 'over', soCount: 3 }, '2026-09-16');
  assert.deepEqual([forced.incentive, forced.reward, forced.durationAuto, forced.soCountAuto, forced.rewardAuto], ['dapat', 'cash_500', false, false, true]);
  // A reward picked by hand wins.
  assert.equal(resolveReward({ ...base, reward: 'voucher_500' }, '2026-09-16').reward, 'voucher_500');
});

check('a new row carries Tgl Masuk + earlier SO dates from the last Super Reward (last three, oldest first)', () => {
  const p = person('u2', 'Shalsa', 'pic_2');
  const fresh = newRewardRow(p, '2026-09-16');
  assert.deepEqual([fresh.joinDate, fresh.soDates], [null, ['2026-09-16', null, null]]);
  const prev = { ...newRewardRow(p, '2025-10-08'), joinDate: '2024-12-31' };
  const next = newRewardRow(p, '2026-09-16', prev);
  assert.deepEqual([next.joinDate, next.soDates], ['2024-12-31', ['2025-10-08', '2026-09-16', null]]);
  const full = newRewardRow(p, '2027-03-01', { ...prev, soDates: ['2025-10-08', '2026-03-01', '2026-09-16'] });
  assert.deepEqual(full.soDates, ['2026-03-01', '2026-09-16', '2027-03-01']);
});

check('sort (PIC 1 → PIC 2 → SA → none), clean-up and paper dates', () => {
  const sorted = sortRewardRows([person('a', 'A', 'sa'), person('b', 'B', null), person('c', 'C', 'pic_2'), person('d', 'D', 'sa'), person('e', 'E', 'pic_1')]);
  assert.deepEqual(sorted.map((r) => r.userId), ['e', 'c', 'a', 'd', 'b']);
  const cleaned = cleanRewardRows([
    { userId: 'u1', nik: ' a1 ', name: '  Sari  Intan ', type: 'pic_1', joinDate: '2026-01-01', soDates: ['2026-09-16', 'bad'], soCount: '12', reward: 'gold' },
    { userId: 'u1', name: 'Duplicate' },
    { userId: null, name: '' },
    'junk',
  ]);
  assert.equal(cleaned.length, 1);
  assert.deepEqual(
    [cleaned[0].nik, cleaned[0].name, cleaned[0].soDates, cleaned[0].soCount, cleaned[0].reward, cleaned[0].duration],
    ['A1', 'Sari Intan', ['2026-09-16', null, null], 9, null, null],
  );
  assert.equal(sheetDate('2026-01-01'), '1-Jan-26');
  assert.equal(sheetDate('2026-09-16'), '16-Sep-26');
  assert.equal(sheetDate(null), '');
  assert.equal(rewardTitle('FS020', 'FISIK SPORT  PLAZA MEDAN FAIR'), 'LAMPIRAN REGULAR REWARD STOCK OPNAME FS020 FISIK SPORT PLAZA MEDAN FAIR');
});

console.log(`\n${passed} checks passed`);
