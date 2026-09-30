// lib/setoran-review-xlsx.ts
//
// Builds the Setoran workbooks (server-only — pulls in xlsx-js-style), styled
// like the Petty Cash Report: "Semua Toko" (every store), "Per Kode Toko"
// (subtotal per store code) and one sheet per code.
//   • buildDayWorkbook   — one day's review, used by /api/finance/setoran/export?date=
//   • buildMonthWorkbook — the monthly report, used by …/export?month=

import XlsxStyle from 'xlsx-js-style';
import {
  FONT,
  HEADER_ROW,
  MONEY_FORMAT,
  S,
  put,
  sheetTitle,
  solid,
  type CellStyle,
} from '@/lib/petty-cash-report-xlsx';
import {
  STATUS_META,
  deriveReviewStatus,
  fmtDateLong,
  fmtDateTime,
  fmtDateShort,
  groupRowsByCode,
  missingEvidence,
  sumDay,
  sumMonth,
  type CodeGroup,
  type ReviewStatus,
  type SetoranMonthRow,
  type SetoranStoreRow,
} from '@/lib/setoran-review';
import { reportMonthLabel, storeCodeBrand } from '@/lib/petty-cash-report';

// ─── Column-driven sheet builder ─────────────────────────────────────────────

type CellKind = 'text' | 'mono' | 'money' | 'center';

export interface Column<T> {
  header: string;
  width: number;
  kind: CellKind;
  value: (row: T) => string | number | null;
  /** Override the base style — amber for gaps, coloured status cells… */
  style?: (row: T) => CellStyle | undefined;
  /** Total-row value; leave out for a blank cell. */
  total?: (rows: T[]) => string | number;
}

const BASE: Record<CellKind, CellStyle> = {
  text: S.text,
  mono: S.mono,
  money: S.money,
  center: S.textCenter,
};

export const TONE = {
  rose:  { ...S.textCenter, font: { ...FONT, bold: true, color: { rgb: '9F1239' } }, fill: solid('FFE4E6') },
  amber: { ...S.textCenter, font: { ...FONT, bold: true, color: { rgb: '92400E' } }, fill: solid('FEF3C7') },
  green: { ...S.textCenter, font: { ...FONT, bold: true, color: { rgb: '047857' } }, fill: solid('D1FAE5') },
  blue:  { ...S.textCenter, font: { ...FONT, bold: true, color: { rgb: '1D4ED8' } }, fill: solid('DBEAFE' ) },
  slate: { ...S.textCenter, font: { ...FONT, color: { rgb: '475569' } }, fill: solid('F1F5F9') },
} satisfies Record<string, CellStyle>;

const STATUS_TONE: Record<ReviewStatus, CellStyle> = {
  belum_setor: TONE.rose,
  pending: TONE.rose,
  kurang: TONE.amber,
  draft: TONE.blue,
  belum_mulai: TONE.slate,
  selesai: TONE.green,
  tanpa_setoran: TONE.slate,
};

export function buildSheet<T>(
  title: string,
  subtitle: string,
  columns: Column<T>[], // columns[0] is always the row number
  rows: T[],
  labelCol: number,
) {
  const ws: XlsxStyle.WorkSheet = {};
  const lastCol = columns.length - 1;

  ws['!cols'] = columns.map((c) => ({ wch: c.width }));
  sheetTitle(ws, lastCol, title, subtitle);
  columns.forEach((c, i) => put(ws, HEADER_ROW, i, c.header, S.header));

  rows.forEach((row, ri) => {
    const r = HEADER_ROW + 1 + ri;
    columns.forEach((c, ci) => {
      const v = c.value(row);
      const style = c.style?.(row) ?? BASE[c.kind];
      if (v == null) put(ws, r, ci, '-', S.textCenter);
      else put(ws, r, ci, v, style, typeof v === 'number' && c.kind === 'money' ? MONEY_FORMAT : undefined);
    });
    ws['!rows']![r] = { hpt: 18 };
  });

  const totalRow = HEADER_ROW + 1 + rows.length;
  columns.forEach((c, ci) => {
    if (ci === labelCol) put(ws, totalRow, ci, 'TOTAL', S.totalLabel);
    else if (c.total) {
      const v = c.total(rows);
      put(ws, totalRow, ci, v, S.totalMoney, typeof v === 'number' && c.kind === 'money' ? MONEY_FORMAT : undefined);
    } else put(ws, totalRow, ci, '', S.totalBlank);
  });
  ws['!rows']![totalRow] = { hpt: 20 };

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: lastCol } });
  ws['!autofilter'] = {
    ref: XlsxStyle.utils.encode_range({ s: { r: HEADER_ROW, c: 0 }, e: { r: HEADER_ROW + rows.length, c: lastCol } }),
  };
  return ws;
}

export const sheetTitleFor = (prefix: string, g: CodeGroup<unknown>) => {
  const brand = storeCodeBrand(g.code);
  return `${prefix} ${g.display}${brand && brand !== g.display ? ` — ${brand}` : ''}`;
};

export type WorkbookResult =
  | { ok: true; buffer: Buffer; suffix: string }
  | { ok: false; error: string };

export function finish(wb: XlsxStyle.WorkBook, suffix: string): WorkbookResult {
  const buffer = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
  return { ok: true, buffer, suffix };
}

export const stamp = () =>
  new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

// ─── Daily review ────────────────────────────────────────────────────────────

export function buildDayWorkbook(input: {
  date: string;
  /** Today in Jakarta — decides whether "not submitted" is a miss yet. */
  today: string;
  rows: SetoranStoreRow[];
  code: string | null;
  unverifiedOnly: boolean;
  exportedBy: string;
}): WorkbookResult {
  const { date, today, code, unverifiedOnly, exportedBy } = input;
  const isPast = date < today;
  const rows = unverifiedOnly ? input.rows.filter((r) => r.canVerify) : input.rows;
  const statusOf = (r: SetoranStoreRow) => deriveReviewStatus(r, isPast);

  const columns: Column<SetoranStoreRow>[] = [
    { header: 'No', width: 5, kind: 'center', value: () => null },
    { header: 'Kode Toko', width: 11, kind: 'mono', value: (r) => r.storeNo },
    { header: 'Nama Toko', width: 36, kind: 'text', value: (r) => r.storeName },
    { header: 'Area', width: 20, kind: 'text', value: (r) => r.areaName },
    { header: 'Diterima (Rp)', width: 16, kind: 'money', value: (r) => r.received, total: (rs) => sumDay(rs).received },
    { header: 'Sisa Kemarin (Rp)', width: 17, kind: 'money', value: (r) => r.carryIn, total: (rs) => sumDay(rs).carryIn },
    { header: 'Wajib Disetor (Rp)', width: 18, kind: 'money', value: (r) => r.required, total: (rs) => sumDay(rs).required },
    { header: 'Disetor (Rp)', width: 16, kind: 'money', value: (r) => r.stored, total: (rs) => sumDay(rs).stored },
    { header: 'Sisa (Rp)', width: 16, kind: 'money', value: (r) => r.unpaid, total: (rs) => sumDay(rs).unpaid },
    {
      header: 'Status', width: 15, kind: 'center',
      value: (r) => (statusOf(r) === 'kurang' ? `Kurang ${(r.unpaid ?? 0).toLocaleString('id-ID')}` : STATUS_META[statusOf(r)].label),
      style: (r) => STATUS_TONE[statusOf(r)],
    },
    {
      header: 'Verifikasi', width: 22, kind: 'center',
      value: (r) => (r.verifiedAt ? `${r.verifiedBy ?? 'Finance'} · ${fmtDateTime(r.verifiedAt)}` : r.canVerify ? 'Belum diverifikasi' : '-'),
      style: (r) => (r.verifiedAt ? TONE.green : r.canVerify ? TONE.amber : undefined),
    },
    {
      header: 'Bukti Foto', width: 22, kind: 'center',
      value: (r) => (r.status !== 'completed' ? '-' : missingEvidence(r).length ? `Kurang: ${missingEvidence(r).join(', ')}` : 'Lengkap'),
      style: (r) => (missingEvidence(r).length ? TONE.amber : undefined),
    },
    { header: 'Disubmit Oleh', width: 24, kind: 'text', value: (r) => r.submittedBy },
    { header: 'Waktu Submit', width: 16, kind: 'center', value: (r) => fmtDateTime(r.submittedAt) },
    { header: 'Catatan', width: 34, kind: 'text', value: (r) => r.notes },
  ];

  const numbered = (cols: Column<SetoranStoreRow>[]) => {
    let n = 0;
    return cols.map((c, i) => (i === 0 ? { ...c, value: () => ++n } : c));
  };
  // The running number restarts for every sheet — build fresh columns per sheet.
  const sheet = (title: string, sub: string, list: SetoranStoreRow[]) => buildSheet(title, sub, numbered(columns), list, 2);

  const subtitle = `Tanggal ${fmtDateLong(date)}  ·  Diekspor ${stamp()} oleh ${exportedBy}${unverifiedOnly ? '  ·  Hanya yang belum diverifikasi' : ''}`;
  const groups = groupRowsByCode(rows);
  const wb = XlsxStyle.utils.book_new();

  if (code) {
    const g = groups.find((x) => x.code === code || x.display.toUpperCase() === code);
    if (!g) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('SETORAN HARIAN', g), subtitle, g.rows), g.display);
    return finish(wb, `_${g.display}`);
  }

  XlsxStyle.utils.book_append_sheet(wb, sheet('SETORAN HARIAN — SEMUA TOKO', subtitle, rows), 'Semua Toko');

  const summaryCols: Column<CodeGroup<SetoranStoreRow>>[] = [
    { header: 'Kode', width: 10, kind: 'mono', value: (g) => g.display },
    { header: 'Merek', width: 22, kind: 'text', value: (g) => g.brand },
    { header: 'Jumlah Toko', width: 14, kind: 'center', value: (g) => g.rows.length, total: (gs) => gs.reduce((s, g) => s + g.rows.length, 0) },
    { header: 'Diterima (Rp)', width: 18, kind: 'money', value: (g) => sumDay(g.rows).received, total: (gs) => gs.reduce((s, g) => s + sumDay(g.rows).received, 0) },
    { header: 'Disetor (Rp)', width: 18, kind: 'money', value: (g) => sumDay(g.rows).stored, total: (gs) => gs.reduce((s, g) => s + sumDay(g.rows).stored, 0) },
    { header: 'Sisa (Rp)', width: 18, kind: 'money', value: (g) => sumDay(g.rows).unpaid, total: (gs) => gs.reduce((s, g) => s + sumDay(g.rows).unpaid, 0) },
    {
      header: 'Perlu Perhatian', width: 16, kind: 'center',
      value: (g) => g.rows.filter((r) => STATUS_META[statusOf(r)].attention).length,
      style: (g) => (g.rows.some((r) => STATUS_META[statusOf(r)].attention) ? TONE.amber : undefined),
      total: (gs) => gs.reduce((s, g) => s + g.rows.filter((r) => STATUS_META[statusOf(r)].attention).length, 0),
    },
  ];
  XlsxStyle.utils.book_append_sheet(wb, buildSheet('RINGKASAN PER KODE TOKO', subtitle, summaryCols, groups, 1), 'Per Kode Toko');

  for (const g of groups) {
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('SETORAN HARIAN', g), subtitle, g.rows), g.display);
  }
  return finish(wb, '');
}

// ─── Monthly report ──────────────────────────────────────────────────────────

export function buildMonthWorkbook(input: {
  month: string;
  rows: SetoranMonthRow[];
  code: string | null;
  onlyIssues: boolean;
  exportedBy: string;
}): WorkbookResult {
  const { month, code, onlyIssues, exportedBy } = input;
  const rows = onlyIssues ? input.rows.filter((r) => r.missedDays > 0 || r.unverified > 0) : input.rows;

  const num = (pick: (t: ReturnType<typeof sumMonth>) => number) => (rs: SetoranMonthRow[]) => pick(sumMonth(rs));

  const columns: Column<SetoranMonthRow>[] = [
    { header: 'No', width: 5, kind: 'center', value: () => null },
    { header: 'Kode Toko', width: 11, kind: 'mono', value: (r) => r.storeNo },
    { header: 'Nama Toko', width: 36, kind: 'text', value: (r) => r.storeName },
    { header: 'Area', width: 20, kind: 'text', value: (r) => r.areaName },
    { header: 'Hari Kerja', width: 11, kind: 'center', value: (r) => r.workDays, total: num((t) => t.workDays) },
    { header: 'Setor', width: 9, kind: 'center', value: (r) => r.depositDays, total: num((t) => t.depositDays) },
    { header: 'Tanpa Setor', width: 12, kind: 'center', value: (r) => r.noDepositDays, total: num((t) => t.noDepositDays) },
    {
      header: 'Belum Setor', width: 12, kind: 'center', value: (r) => r.missedDays,
      style: (r) => (r.missedDays > 0 ? TONE.rose : undefined), total: num((t) => t.missedDays),
    },
    { header: 'Diterima (Rp)', width: 18, kind: 'money', value: (r) => r.totalReceived, total: num((t) => t.totalReceived) },
    { header: 'Disetor (Rp)', width: 18, kind: 'money', value: (r) => r.totalStored, total: num((t) => t.totalStored) },
    { header: 'Sisa Akhir (Rp)', width: 18, kind: 'money', value: (r) => r.closingUnpaid, total: num((t) => t.closingUnpaid) },
    {
      header: 'Belum Verifikasi', width: 16, kind: 'center', value: (r) => r.unverified,
      style: (r) => (r.unverified > 0 ? TONE.amber : undefined), total: num((t) => t.unverified),
    },
    { header: 'Setor Terakhir', width: 14, kind: 'center', value: (r) => (r.lastSubmittedDate ? fmtDateShort(r.lastSubmittedDate) : null) },
  ];

  const numbered = () => {
    let n = 0;
    return columns.map((c, i) => (i === 0 ? { ...c, value: () => ++n } : c));
  };
  const sheet = (title: string, sub: string, list: SetoranMonthRow[]) => buildSheet(title, sub, numbered(), list, 2);

  const subtitle = `Periode ${reportMonthLabel(month)}  ·  Diekspor ${stamp()} oleh ${exportedBy}${onlyIssues ? '  ·  Hanya toko bermasalah' : ''}`;
  const groups = groupRowsByCode(rows);
  const wb = XlsxStyle.utils.book_new();

  if (code) {
    const g = groups.find((x) => x.code === code || x.display.toUpperCase() === code);
    if (!g) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN SETORAN', g), subtitle, g.rows), g.display);
    return finish(wb, `_${g.display}`);
  }

  XlsxStyle.utils.book_append_sheet(wb, sheet('LAPORAN SETORAN — SEMUA TOKO', subtitle, rows), 'Semua Toko');

  const sumOf = (g: CodeGroup<SetoranMonthRow>) => sumMonth(g.rows);
  const summaryCols: Column<CodeGroup<SetoranMonthRow>>[] = [
    { header: 'Kode', width: 10, kind: 'mono', value: (g) => g.display },
    { header: 'Merek', width: 22, kind: 'text', value: (g) => g.brand },
    { header: 'Jumlah Toko', width: 14, kind: 'center', value: (g) => g.rows.length, total: (gs) => gs.reduce((s, g) => s + g.rows.length, 0) },
    {
      header: 'Belum Setor (hari)', width: 18, kind: 'center', value: (g) => sumOf(g).missedDays,
      style: (g) => (sumOf(g).missedDays > 0 ? TONE.rose : undefined),
      total: (gs) => gs.reduce((s, g) => s + sumOf(g).missedDays, 0),
    },
    { header: 'Diterima (Rp)', width: 18, kind: 'money', value: (g) => sumOf(g).totalReceived, total: (gs) => gs.reduce((s, g) => s + sumOf(g).totalReceived, 0) },
    { header: 'Disetor (Rp)', width: 18, kind: 'money', value: (g) => sumOf(g).totalStored, total: (gs) => gs.reduce((s, g) => s + sumOf(g).totalStored, 0) },
    { header: 'Sisa Akhir (Rp)', width: 18, kind: 'money', value: (g) => sumOf(g).closingUnpaid, total: (gs) => gs.reduce((s, g) => s + sumOf(g).closingUnpaid, 0) },
    {
      header: 'Belum Verifikasi', width: 16, kind: 'center', value: (g) => sumOf(g).unverified,
      style: (g) => (sumOf(g).unverified > 0 ? TONE.amber : undefined),
      total: (gs) => gs.reduce((s, g) => s + sumOf(g).unverified, 0),
    },
  ];
  XlsxStyle.utils.book_append_sheet(wb, buildSheet('RINGKASAN PER KODE TOKO', subtitle, summaryCols, groups, 1), 'Per Kode Toko');

  for (const g of groups) {
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN SETORAN', g), subtitle, g.rows), g.display);
  }
  return finish(wb, '');
}
