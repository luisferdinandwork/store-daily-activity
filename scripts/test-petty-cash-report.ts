// Pure regression checks for the bank-transfer export and the page's shared filters. No DB.
// Run: npx tsx scripts/test-petty-cash-report.ts
import assert from 'node:assert/strict';
import XlsxStyle from 'xlsx-js-style';
import { buildReportCsv } from '../lib/petty-cash-report-csv';
import { groupByStoreCode, selectReportRows, type PettyCashReportRow } from '../lib/petty-cash-report';

function row(id: number, overrides: Partial<PettyCashReportRow> = {}): PettyCashReportRow {
  return {
    storeId: id,
    storeNo: `FF${id.toString().padStart(3, '0')}`,
    storeName: `Fisik ${id}`,
    areaName: 'Area Test',
    code: 'FF',
    deptCode: 'TEST',
    storeStatus: 'active',
    totalUsed: 150000,
    txCount: 1,
    complete: true,
    open: { pendingOps: 0, awaitingActual: 0, fixing: 0, pendingFinance: 0 },
    pic1Name: 'PIC Test',
    bankName: 'BCA',
    accountNumber: '0948257443',
    accountHolderName: 'BENEFICIARY TEST',
    refill: {
      id,
      yearMonth: '2026-11',
      state: 'awaiting_finance',
      requestedAt: '2026-11-14T01:00:00.000Z',
      approvedAt: '2026-11-15T01:00:00.000Z',
      verifiedAt: null,
      verifiedByName: null,
      receivedAt: null,
      proofCount: 0,
      transfer: 245678,
      transferFrozen: false,
    },
    ...overrides,
  };
}

function parse(csv: string): string[][] {
  const wb = XlsxStyle.read(csv, { type: 'string', raw: true });
  return XlsxStyle.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, raw: true, blankrows: false, defval: '',
  });
}

const now = new Date('2026-11-17T17:05:00.000Z'); // Already 18 November in Jakarta.
const csv = buildReportCsv({ month: '2026-11', rows: [row(1)], now });
const records = parse(csv);
assert.equal(csv.split('\r\n')[0], 'Beneficiary Name,Transf. Date,Transf. Amount,Account No,Bank Name,BI Code,Bank Branch Name,Remark 1,Remark 2,Jenis,Receiver Cust Type,Receiver Cust Residence');
assert.deepEqual(records[1], [
  'BENEFICIARY TEST', '18/11/2026', '245678.00', '0948257443', 'BCA',
  '1111111', 'CAB JAKARTA', 'PETTY CASH', 'NOV 2026', 'BCA', '1', 'N',
]);
assert.equal(records.length, 2); // No summary/title/footer rows.
assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false);
assert.ok(csv.endsWith('\r\n'));

const special = row(2, {
  accountHolderName: 'Nama, "Éka"\r\nCabang',
  bankName: 'Bank, Test',
  accountNumber: '00012345678901234567',
});
const specialCsv = buildReportCsv({ month: '2026-10', rows: [special], now });
assert.ok(specialCsv.includes('"Nama, ""Éka""\r\nCabang"'));
const escaped = parse(specialCsv)[1];
assert.equal(escaped[0], special.accountHolderName!.replace(/\r\n/g, '\n')); // The independent parser normalizes line breaks.
assert.equal(escaped[3], special.accountNumber);
assert.equal(escaped[4], special.bankName);
assert.equal(escaped[8], 'OKT 2026');
assert.deepEqual(escaped.slice(9), ['BCA', '1', 'N']); // Fixed template values even for other banks.

const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
months.forEach((name, i) => {
  const month = `2027-${String(i + 1).padStart(2, '0')}`;
  assert.equal(parse(buildReportCsv({ month, rows: [row(1)], now }))[1][8], `${name} 2027`);
});
assert.equal(parse(buildReportCsv({ month: '2026-11', rows: [row(1)], now: new Date('2026-11-17T16:59:59Z') }))[1][1], '17/11/2026');
assert.equal(parse(buildReportCsv({ month: '2026-11', rows: [row(1)], now: new Date('2026-12-31T17:00:00Z') }))[1][1], '01/01/2027');

const base = row(1);
const amounts = parse(buildReportCsv({
  month: '2026-11', now,
  rows: [
    row(1, { refill: { ...base.refill!, transfer: 0 } }),
    row(2, { refill: { ...base.refill!, transfer: null } }),
    row(3, { refill: null, bankName: null, accountNumber: null, accountHolderName: null }),
  ],
}));
assert.equal(amounts[1][2], '0.00');
assert.equal(amounts[2][2], ''); // Unknown transfer never falls back to Total Terpakai.
assert.equal(amounts[3][2], '');
assert.equal(amounts[3][3], '');
assert.equal(parse(buildReportCsv({ month: '2026-11', rows: [], now })).length, 1);

const rows = [
  row(10, { bankName: 'Mandiri' }),
  row(2),
  row(1, { bankName: ' bCa ' }),
  row(3, { bankName: 'CIMB Niaga', code: 'OD', storeNo: 'OD003' }),
  row(4, { bankName: null }),
  row(5, { totalUsed: 0 }),
  row(6, { complete: false, open: { pendingOps: 1, awaitingActual: 0, fixing: 0, pendingFinance: 0 } }),
  row(7, { refill: { ...base.refill!, id: 7, state: 'verified', transferFrozen: true } }),
];
const originalIds = rows.map((r) => r.storeId);
const ids = (selected: PettyCashReportRow[]) => selected.map((r) => r.storeId);
assert.deepEqual(ids(selectReportRows(rows, { sort: 'bank_asc' })), [1, 2, 5, 6, 7, 3, 10, 4]);
assert.deepEqual(ids(selectReportRows(rows, { sort: 'bank_desc' })), [10, 3, 1, 2, 5, 6, 7, 4]);
assert.deepEqual(ids(selectReportRows(rows, { code: 'ODD' })), [3]);
assert.deepEqual(ids(selectReportRows(rows, { search: 'cimb' })), [3]);
assert.deepEqual(ids(selectReportRows(rows, { bank: 'mandiri' })), [10]);
assert.deepEqual(ids(selectReportRows(rows, { search: '094825', bank: 'BCA', onlyUsed: true, onlyAwaiting: true, code: 'FF' })), [1, 2]);
assert.deepEqual(ids(selectReportRows(rows, { search: 'no matching store' })), []);
assert.deepEqual(ids(rows), originalIds); // Filtering/sorting never mutates fetched data.

const exported = parse(buildReportCsv({
  month: '2026-11', rows, now,
  filters: { bank: 'BCA', onlyUsed: true, onlyAwaiting: true, search: 'Fisik', code: 'FF', sort: 'bank_desc' },
}));
assert.deepEqual(exported.slice(1).map((record) => record[0]), ['BENEFICIARY TEST', 'BENEFICIARY TEST']);
assert.equal(exported.slice(1).reduce((sum, record) => sum + Number(record[2]), 0), 491356);

const groupedRows = [row(1, { bankName: 'Mandiri', accountHolderName: 'FF MANDIRI' }), row(2, { accountHolderName: 'FF BCA' }), row(3, { code: 'FO', storeNo: 'FO003', accountHolderName: 'FO BCA' })];
assert.deepEqual(groupByStoreCode(groupedRows, 'bank_asc').map((group) => ids(group.rows)), [[2, 1], [3]]);
assert.deepEqual(parse(buildReportCsv({ month: '2026-11', rows: groupedRows, grouped: true, filters: { sort: 'bank_asc' }, now })).slice(1).map((record) => record[0]), ['FF BCA', 'FF MANDIRI', 'FO BCA']);
assert.deepEqual(parse(buildReportCsv({ month: '2026-11', rows: groupedRows, filters: { sort: 'bank_asc' }, now })).slice(1).map((record) => record[0]), ['FF BCA', 'FO BCA', 'FF MANDIRI']);

console.log('Petty cash report CSV and filter checks passed.');
