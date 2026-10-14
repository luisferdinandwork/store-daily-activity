// lib/store-closing-money-xlsx.ts
//
// The Store Closing · Report workbook (server-only — pulls in xlsx-js-style), laid
// out like Finance's own sheet: Kode · Store · Total Sales · Tanggal Sales ·
// Tanggal Setoran · the cash block · one column per bank · OP/ME/VOUCHER. One sheet
// for every store plus one per store code. Reuses the Setoran workbook's builder.

import XlsxStyle from 'xlsx-js-style';
import { buildSheet, finish, sheetTitleFor, stamp, TONE, type Column, type WorkbookResult } from '@/lib/setoran-review-xlsx';
import { EDC_BANKS } from '@/lib/store-closing-edc';
import {
  fmtRange,
  fmtDateShort,
  groupRowsByCode,
  sumMoney,
  totalSales,
  type ClosingMoneyRow,
} from '@/lib/store-closing-money';

const sum = (rs: ClosingMoneyRow[], pick: (t: ReturnType<typeof sumMoney>) => number) => pick(sumMoney(rs));

function columns(): Column<ClosingMoneyRow>[] {
  let n = 0;
  return [
    { header: 'No', width: 5, kind: 'center', value: () => ++n },
    { header: 'Kode', width: 11, kind: 'mono', value: (r) => r.storeNo },
    { header: 'Store', width: 36, kind: 'text', value: (r) => r.storeName },
    { header: 'Total Sales (Rp)', width: 18, kind: 'money', value: (r) => totalSales(r), total: (rs) => sum(rs, (t) => t.totalSales) },
    { header: 'Tanggal Sales', width: 14, kind: 'center', value: (r) => fmtDateShort(r.salesDate) },
    { header: 'Tanggal Setoran', width: 15, kind: 'center', value: (r) => fmtDateShort(r.setoranDate) },
    {
      header: 'Cash · Uang Diterima (Rp)', width: 20, kind: 'money',
      value: (r) => r.setoran?.received ?? null, total: (rs) => sum(rs, (t) => t.received),
    },
    {
      header: 'Cash · Sisa Kemarin (Rp)', width: 20, kind: 'money',
      value: (r) => r.setoran?.carryIn ?? null, total: (rs) => sum(rs, (t) => t.carryIn),
    },
    {
      header: 'Cash · Wajib Disetor (Rp)', width: 20, kind: 'money',
      value: (r) => r.setoran?.required ?? null, total: (rs) => sum(rs, (t) => t.required),
    },
    {
      header: 'Cash · Disetor (Rp)', width: 18, kind: 'money',
      value: (r) => r.setoran?.stored ?? null, total: (rs) => sum(rs, (t) => t.stored),
    },
    {
      header: 'Cash · Sisa (Rp)', width: 18, kind: 'money',
      value: (r) => r.setoran?.unpaid ?? null,
      style: (r) => ((r.setoran?.unpaid ?? 0) > 0 ? { ...TONE.amber, alignment: { horizontal: 'right', vertical: 'center' } } : undefined),
      total: (rs) => sum(rs, (t) => t.unpaid),
    },
    { header: 'Catatan Setoran', width: 34, kind: 'text', value: (r) => r.setoran?.notes ?? (r.setoran?.isNoSetoran ? 'Tanpa setoran' : null) },
    ...EDC_BANKS.map((b): Column<ClosingMoneyRow> => ({
      header: `Card · ${b.label} (Rp)`, width: 18, kind: 'money',
      value: (r) => r.banks[b.code], total: (rs) => sum(rs, (t) => t.banks[b.code]),
    })),
    {
      header: 'OP/ME/VOUCHER (Rp)', width: 20, kind: 'money',
      value: (r) => r.opMeVoucher, total: (rs) => sum(rs, (t) => t.opMeVoucher),
    },
  ];
}

export function buildMoneyWorkbook(input: {
  from: string;
  to: string;
  rows: ClosingMoneyRow[];
  code: string | null;
  exportedBy: string;
}): WorkbookResult {
  const { from, to, code, rows, exportedBy } = input;
  const sheet = (title: string, sub: string, list: ClosingMoneyRow[]) => buildSheet(title, sub, columns(), list, 2);

  const subtitle = `Penjualan ${fmtRange(from, to)}  ·  Diekspor ${stamp()} oleh ${exportedBy}  ·  Cash dari Setoran hari berikutnya, kartu dari Store Closing`;
  const groups = groupRowsByCode(rows);
  const wb = XlsxStyle.utils.book_new();

  if (code) {
    const g = groups.find((x) => x.code === code || x.display.toUpperCase() === code);
    if (!g) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN STORE CLOSING', g), subtitle, g.rows), g.display);
    return finish(wb, `_${g.display}`);
  }

  XlsxStyle.utils.book_append_sheet(wb, sheet('LAPORAN STORE CLOSING — SEMUA TOKO', subtitle, rows), 'Semua Toko');
  for (const g of groups) {
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN STORE CLOSING', g), subtitle, g.rows), g.display);
  }
  return finish(wb, '');
}
