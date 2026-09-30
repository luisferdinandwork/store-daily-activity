// lib/petty-cash-transactions-xlsx.ts
//
// Builds the Petty Cash Transactions workbook (server-only — pulls in
// xlsx-js-style): "Transaksi" (one row per request, exactly the rows the filters
// select) and "Ringkasan" (count / amounts per status). Used by
// app/api/finance/petty-cash/transactions/export.

import XlsxStyle from 'xlsx-js-style';
import { fmtRange } from '@/lib/finance/dates';
import {
  HEADER_ROW,
  MONEY_FORMAT,
  S,
  put,
  sheetTitle,
} from '@/lib/petty-cash-report-xlsx';
import {
  TX_STATUS_LABEL,
  TX_STATUS_ORDER,
  isTxStatus,
  type TransactionRow,
  type TxStatus,
} from '@/lib/petty-cash-transactions';

const stampOf = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

const statusLabel = (status: string) => (isTxStatus(status) ? TX_STATUS_LABEL[status] : status);

/** Completed requests are the ones actually deducted, at the recorded actual amount. */
const usedOf = (r: TransactionRow) => (r.status === 'completed' ? r.actualAmount ?? r.amount : 0);

function buildTransactionsSheet(title: string, subtitle: string, rows: TransactionRow[]) {
  const ws: XlsxStyle.WorkSheet = {};
  const headers = [
    'No', 'Tanggal', 'Kode Toko', 'Nama Toko', 'Kategori', 'Keterangan', 'Diajukan Oleh',
    'Diajukan (Rp)', 'Aktual (Rp)', 'Status', 'Alasan Ditolak', 'Foto Struk',
  ];
  const lastCol = headers.length - 1;

  ws['!cols'] = [
    { wch: 5 }, { wch: 20 }, { wch: 11 }, { wch: 34 }, { wch: 20 }, { wch: 44 }, { wch: 22 },
    { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 30 }, { wch: 14 },
  ];
  sheetTitle(ws, lastCol, title, subtitle);
  headers.forEach((h, c) => put(ws, HEADER_ROW, c, h, S.header));

  rows.forEach((tx, i) => {
    const r = HEADER_ROW + 1 + i;
    put(ws, r, 0, i + 1, S.textCenter);
    put(ws, r, 1, stampOf(tx.createdAt), S.text);
    put(ws, r, 2, tx.storeNo, S.mono);
    put(ws, r, 3, tx.storeName, S.text);
    put(ws, r, 4, tx.categoryName ?? '-', S.text);
    put(ws, r, 5, tx.description, { ...S.text, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } });
    put(ws, r, 6, tx.submittedBy, S.text);
    put(ws, r, 7, tx.amount, S.money, MONEY_FORMAT);
    if (tx.actualAmount != null) put(ws, r, 8, tx.actualAmount, S.money, MONEY_FORMAT);
    else put(ws, r, 8, '-', S.textCenter);
    // Amber while the request is still waiting on someone, like the other exports' "missing" cells.
    put(ws, r, 9, statusLabel(tx.status), tx.status === 'completed' ? S.textCenter : S.missing);
    put(ws, r, 10, tx.status === 'ops_rejected' ? tx.rejectionReason ?? '-' : '-', S.text);

    if (tx.imageUrl && /^https?:\/\//i.test(tx.imageUrl)) {
      put(ws, r, 11, 'Lihat foto', S.textCenter);
      ws[XlsxStyle.utils.encode_cell({ r, c: 11 })].l = { Target: tx.imageUrl };
    } else {
      put(ws, r, 11, tx.imageUrl ? 'Ada' : '-', S.textCenter);
    }
    ws['!rows']![r] = { hpt: 18 };
  });

  const totalRow = HEADER_ROW + 1 + rows.length;
  for (let c = 0; c <= lastCol; c++) put(ws, totalRow, c, '', S.totalBlank);
  put(ws, totalRow, 6, 'TOTAL TERPAKAI (Completed)', S.totalLabel);
  put(ws, totalRow, 8, rows.reduce((sum, r) => sum + usedOf(r), 0), S.totalMoney, MONEY_FORMAT);
  ws['!rows']![totalRow] = { hpt: 20 };

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: lastCol } });
  ws['!autofilter'] = {
    ref: XlsxStyle.utils.encode_range({ s: { r: HEADER_ROW, c: 0 }, e: { r: HEADER_ROW + rows.length, c: lastCol } }),
  };
  return ws;
}

function buildSummarySheet(title: string, subtitle: string, rows: TransactionRow[]) {
  const ws: XlsxStyle.WorkSheet = {};
  const headers = ['Status', 'Jumlah Request', 'Diajukan (Rp)', 'Aktual (Rp)'];
  const lastCol = headers.length - 1;

  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
  sheetTitle(ws, lastCol, title, subtitle);
  headers.forEach((h, c) => put(ws, HEADER_ROW, c, h, S.header));

  const known = new Set<string>(TX_STATUS_ORDER);
  const statuses: string[] = [...TX_STATUS_ORDER, ...new Set(rows.map((r) => r.status).filter((s) => !known.has(s)))];
  statuses.forEach((status, i) => {
    const mine = rows.filter((r) => r.status === status);
    const r = HEADER_ROW + 1 + i;
    put(ws, r, 0, statusLabel(status), S.text);
    put(ws, r, 1, mine.length, S.textCenter);
    put(ws, r, 2, mine.reduce((sum, t) => sum + t.amount, 0), S.money, MONEY_FORMAT);
    put(ws, r, 3, mine.reduce((sum, t) => sum + (t.actualAmount ?? 0), 0), S.money, MONEY_FORMAT);
    ws['!rows']![r] = { hpt: 18 };
  });

  const totalRow = HEADER_ROW + 1 + statuses.length;
  put(ws, totalRow, 0, 'TOTAL', S.totalLabel);
  put(ws, totalRow, 1, rows.length, S.totalMoney);
  put(ws, totalRow, 2, rows.reduce((sum, t) => sum + t.amount, 0), S.totalMoney, MONEY_FORMAT);
  put(ws, totalRow, 3, rows.reduce((sum, t) => sum + (t.actualAmount ?? 0), 0), S.totalMoney, MONEY_FORMAT);
  ws['!rows']![totalRow] = { hpt: 20 };

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: lastCol } });
  return ws;
}

export function buildTransactionsWorkbook(input: {
  from: string;
  to: string;
  /** "FF001 · Fisik Football - Daan Mogot", or null for every store. */
  storeLabel: string | null;
  status: TxStatus | null;
  rows: TransactionRow[];
  exportedBy: string;
}): Buffer {
  const { from, to, storeLabel, status, rows, exportedBy } = input;

  const stamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
  const filters = [
    `Periode ${fmtRange(from, to)}`,
    storeLabel ? `Toko ${storeLabel}` : 'Semua toko',
    status ? `Status ${TX_STATUS_LABEL[status]}` : 'Semua status',
  ].join('  ·  ');
  const subtitle = `${filters}  ·  Diekspor ${stamp} oleh ${exportedBy}`;

  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, buildTransactionsSheet('TRANSAKSI PETTY CASH', subtitle, rows), 'Transaksi');
  XlsxStyle.utils.book_append_sheet(wb, buildSummarySheet('RINGKASAN PER STATUS', subtitle, rows), 'Ringkasan');

  return XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
}
