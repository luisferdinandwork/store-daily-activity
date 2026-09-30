// lib/uang-modal-review-xlsx.ts
//
// Builds the Uang Modal workbooks (server-only — pulls in xlsx-js-style),
// styled like the Petty Cash / Setoran reports: "Semua Toko" (every store),
// "Per Kode Toko" (subtotal per store code) and one sheet per code.
//   • buildDayWorkbook   — one day's review, used by /api/finance/uang-modal/export?date=
//   • buildMonthWorkbook — the monthly report, used by …/export?month=

import XlsxStyle from 'xlsx-js-style';
import {
  TONE,
  buildSheet,
  finish,
  sheetTitleFor,
  stamp,
  type Column,
  type WorkbookResult,
} from '@/lib/setoran-review-xlsx';
import { reportMonthLabel } from '@/lib/petty-cash-report';
import {
  STATUS_META,
  deriveReviewStatus,
  fillPct,
  fmtDateLong,
  fmtDateShort,
  fmtDateTime,
  groupRowsByCode,
  hasMonthIssue,
  shortfallOf,
  sumDay,
  sumMonth,
  type CodeGroup,
  type ReviewStatus,
  type UangModalMonthRow,
  type UangModalRow,
} from '@/lib/uang-modal-review';

const STATUS_TONE: Record<ReviewStatus, (typeof TONE)[keyof typeof TONE]> = {
  belum_lapor: TONE.rose,
  kosong: TONE.rose,
  kurang: TONE.amber,
  draft: TONE.blue,
  belum_mulai: TONE.slate,
  penuh: TONE.green,
};

const rp = (v: number) => `Rp ${v.toLocaleString('id-ID')}`;

/** Re-numbers column 0 for each sheet — the running number restarts per sheet. */
function numbered<T>(columns: Column<T>[]): Column<T>[] {
  let n = 0;
  return columns.map((c, i) => (i === 0 ? { ...c, value: () => ++n } : c));
}

// ─── Daily review ────────────────────────────────────────────────────────────

export function buildDayWorkbook(input: {
  date: string;
  /** Today in Jakarta — decides whether "not reported" is a miss yet. */
  today: string;
  rows: UangModalRow[];
  code: string | null;
  unverifiedOnly: boolean;
  exportedBy: string;
}): WorkbookResult {
  const { date, today, code, unverifiedOnly, exportedBy } = input;
  const isPast = date < today;
  const rows = unverifiedOnly ? input.rows.filter((r) => r.canVerify) : input.rows;
  const statusOf = (r: UangModalRow) => deriveReviewStatus(r, isPast);
  const submitted = (r: UangModalRow) => r.status === 'completed';

  const columns: Column<UangModalRow>[] = [
    { header: 'No', width: 5, kind: 'center', value: () => null },
    { header: 'Kode Toko', width: 11, kind: 'mono', value: (r) => r.storeNo },
    { header: 'Nama Toko', width: 36, kind: 'text', value: (r) => r.storeName },
    { header: 'Area', width: 20, kind: 'text', value: (r) => r.areaName },
    {
      header: 'Terhitung (Rp)', width: 16, kind: 'money', value: (r) => (submitted(r) ? r.total : null),
      total: (rs) => sumDay(rs).total,
    },
    { header: 'Batas (Rp)', width: 14, kind: 'money', value: (r) => r.max },
    {
      header: 'Kurang (Rp)', width: 14, kind: 'money', value: (r) => (submitted(r) ? shortfallOf(r) : null),
      style: (r) => (shortfallOf(r) > 0 ? TONE.amber : undefined),
      total: (rs) => sumDay(rs).shortfall,
    },
    {
      header: 'Terisi (%)', width: 11, kind: 'center', value: (r) => { const p = fillPct(r); return p == null ? null : `${p}%`; },
    },
    {
      header: 'Status', width: 14, kind: 'center', value: (r) => STATUS_META[statusOf(r)].label,
      style: (r) => STATUS_TONE[statusOf(r)],
    },
    {
      header: 'Rincian Pecahan', width: 44, kind: 'text',
      value: (r) => (r.denominations.length ? r.denominations.map((d) => `${d.value.toLocaleString('id-ID')}×${d.quantity}`).join(', ') : null),
    },
    {
      header: 'Verifikasi', width: 22, kind: 'center',
      value: (r) => (r.verifiedAt ? `${r.verifiedBy ?? 'Finance'} · ${fmtDateTime(r.verifiedAt)}` : r.canVerify ? 'Belum diverifikasi' : '-'),
      style: (r) => (r.verifiedAt ? TONE.green : r.canVerify ? TONE.amber : undefined),
    },
    { header: 'Disubmit Oleh', width: 24, kind: 'text', value: (r) => r.submittedBy },
    { header: 'Waktu Submit', width: 16, kind: 'center', value: (r) => fmtDateTime(r.completedAt) },
    { header: 'Catatan', width: 34, kind: 'text', value: (r) => r.notes },
  ];

  const sheet = (title: string, sub: string, list: UangModalRow[]) => buildSheet(title, sub, numbered(columns), list, 2);

  const subtitle = `Tanggal ${fmtDateLong(date)}  ·  Batas modal ${rp(rows[0]?.max ?? 0)}  ·  Diekspor ${stamp()} oleh ${exportedBy}${unverifiedOnly ? '  ·  Hanya yang belum diverifikasi' : ''}`;
  const groups = groupRowsByCode(rows);
  const wb = XlsxStyle.utils.book_new();

  if (code) {
    const g = groups.find((x) => x.code === code || x.display.toUpperCase() === code);
    if (!g) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('UANG MODAL HARIAN', g), subtitle, g.rows), g.display);
    return finish(wb, `_${g.display}`);
  }

  XlsxStyle.utils.book_append_sheet(wb, sheet('UANG MODAL HARIAN — SEMUA TOKO', subtitle, rows), 'Semua Toko');

  const attention = (g: CodeGroup<UangModalRow>) => g.rows.filter((r) => STATUS_META[statusOf(r)].attention).length;
  const summaryCols: Column<CodeGroup<UangModalRow>>[] = [
    { header: 'Kode', width: 10, kind: 'mono', value: (g) => g.display },
    { header: 'Merek', width: 22, kind: 'text', value: (g) => g.brand },
    { header: 'Jumlah Toko', width: 14, kind: 'center', value: (g) => g.rows.length, total: (gs) => gs.reduce((s, g) => s + g.rows.length, 0) },
    { header: 'Terhitung (Rp)', width: 18, kind: 'money', value: (g) => sumDay(g.rows).total, total: (gs) => gs.reduce((s, g) => s + sumDay(g.rows).total, 0) },
    { header: 'Kurang (Rp)', width: 16, kind: 'money', value: (g) => sumDay(g.rows).shortfall, total: (gs) => gs.reduce((s, g) => s + sumDay(g.rows).shortfall, 0) },
    {
      header: 'Perlu Perhatian', width: 16, kind: 'center', value: (g) => attention(g),
      style: (g) => (attention(g) > 0 ? TONE.amber : undefined),
      total: (gs) => gs.reduce((s, g) => s + attention(g), 0),
    },
  ];
  XlsxStyle.utils.book_append_sheet(wb, buildSheet('RINGKASAN PER KODE TOKO', subtitle, summaryCols, groups, 1), 'Per Kode Toko');

  for (const g of groups) {
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('UANG MODAL HARIAN', g), subtitle, g.rows), g.display);
  }
  return finish(wb, '');
}

// ─── Monthly report ──────────────────────────────────────────────────────────

export function buildMonthWorkbook(input: {
  month: string;
  rows: UangModalMonthRow[];
  code: string | null;
  onlyIssues: boolean;
  exportedBy: string;
}): WorkbookResult {
  const { month, code, onlyIssues, exportedBy } = input;
  const rows = onlyIssues ? input.rows.filter(hasMonthIssue) : input.rows;

  const num = (pick: (t: ReturnType<typeof sumMonth>) => number) => (rs: UangModalMonthRow[]) => pick(sumMonth(rs));

  const columns: Column<UangModalMonthRow>[] = [
    { header: 'No', width: 5, kind: 'center', value: () => null },
    { header: 'Kode Toko', width: 11, kind: 'mono', value: (r) => r.storeNo },
    { header: 'Nama Toko', width: 36, kind: 'text', value: (r) => r.storeName },
    { header: 'Area', width: 20, kind: 'text', value: (r) => r.areaName },
    { header: 'Hari Kerja', width: 11, kind: 'center', value: (r) => r.workDays, total: num((t) => t.workDays) },
    { header: 'Penuh', width: 9, kind: 'center', value: (r) => r.fullDays, total: num((t) => t.fullDays) },
    {
      header: 'Belum Penuh', width: 13, kind: 'center', value: (r) => r.shortDays,
      style: (r) => (r.shortDays > 0 ? TONE.amber : undefined), total: num((t) => t.shortDays),
    },
    {
      header: 'Kosong', width: 9, kind: 'center', value: (r) => r.emptyDays,
      style: (r) => (r.emptyDays > 0 ? TONE.rose : undefined), total: num((t) => t.emptyDays),
    },
    {
      header: 'Belum Lapor', width: 12, kind: 'center', value: (r) => r.missedDays,
      style: (r) => (r.missedDays > 0 ? TONE.rose : undefined), total: num((t) => t.missedDays),
    },
    { header: 'Rata-rata (Rp)', width: 16, kind: 'money', value: (r) => r.avgCounted },
    {
      header: 'Terisi (%)', width: 11, kind: 'center', value: (r) => (r.workDays > 0 ? `${r.avgFillPct}%` : null),
    },
    { header: 'Total Kurang (Rp)', width: 18, kind: 'money', value: (r) => r.totalShortfall, total: num((t) => t.totalShortfall) },
    {
      header: 'Belum Penuh Berturut', width: 20, kind: 'center', value: (r) => r.notFullStreak,
      style: (r) => (r.notFullStreak >= 3 ? TONE.rose : r.notFullStreak > 0 ? TONE.amber : undefined),
    },
    {
      header: 'Belum Verifikasi', width: 16, kind: 'center', value: (r) => r.unverified,
      style: (r) => (r.unverified > 0 ? TONE.amber : undefined), total: num((t) => t.unverified),
    },
    { header: 'Lapor Terakhir', width: 14, kind: 'center', value: (r) => (r.lastSubmittedDate ? fmtDateShort(r.lastSubmittedDate) : null) },
  ];

  const sheet = (title: string, sub: string, list: UangModalMonthRow[]) => buildSheet(title, sub, numbered(columns), list, 2);

  const subtitle = `Periode ${reportMonthLabel(month)}  ·  Diekspor ${stamp()} oleh ${exportedBy}${onlyIssues ? '  ·  Hanya toko bermasalah' : ''}`;
  const groups = groupRowsByCode(rows);
  const wb = XlsxStyle.utils.book_new();

  if (code) {
    const g = groups.find((x) => x.code === code || x.display.toUpperCase() === code);
    if (!g) return { ok: false, error: `No stores with code "${code}".` };
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN UANG MODAL', g), subtitle, g.rows), g.display);
    return finish(wb, `_${g.display}`);
  }

  XlsxStyle.utils.book_append_sheet(wb, sheet('LAPORAN UANG MODAL — SEMUA TOKO', subtitle, rows), 'Semua Toko');

  const sumOf = (g: CodeGroup<UangModalMonthRow>) => sumMonth(g.rows);
  const summaryCols: Column<CodeGroup<UangModalMonthRow>>[] = [
    { header: 'Kode', width: 10, kind: 'mono', value: (g) => g.display },
    { header: 'Merek', width: 22, kind: 'text', value: (g) => g.brand },
    { header: 'Jumlah Toko', width: 14, kind: 'center', value: (g) => g.rows.length, total: (gs) => gs.reduce((s, g) => s + g.rows.length, 0) },
    { header: 'Terisi (%)', width: 12, kind: 'center', value: (g) => `${sumOf(g).fillPct}%` },
    {
      header: 'Belum Penuh (hari)', width: 18, kind: 'center', value: (g) => sumOf(g).shortDays,
      style: (g) => (sumOf(g).shortDays > 0 ? TONE.amber : undefined),
      total: (gs) => gs.reduce((s, g) => s + sumOf(g).shortDays, 0),
    },
    {
      header: 'Belum Lapor (hari)', width: 18, kind: 'center', value: (g) => sumOf(g).missedDays,
      style: (g) => (sumOf(g).missedDays > 0 ? TONE.rose : undefined),
      total: (gs) => gs.reduce((s, g) => s + sumOf(g).missedDays, 0),
    },
    { header: 'Total Kurang (Rp)', width: 18, kind: 'money', value: (g) => sumOf(g).totalShortfall, total: (gs) => gs.reduce((s, g) => s + sumOf(g).totalShortfall, 0) },
    {
      header: 'Belum Verifikasi', width: 16, kind: 'center', value: (g) => sumOf(g).unverified,
      style: (g) => (sumOf(g).unverified > 0 ? TONE.amber : undefined),
      total: (gs) => gs.reduce((s, g) => s + sumOf(g).unverified, 0),
    },
  ];
  XlsxStyle.utils.book_append_sheet(wb, buildSheet('RINGKASAN PER KODE TOKO', subtitle, summaryCols, groups, 1), 'Per Kode Toko');

  for (const g of groups) {
    XlsxStyle.utils.book_append_sheet(wb, sheet(sheetTitleFor('LAPORAN UANG MODAL', g), subtitle, g.rows), g.display);
  }
  return finish(wb, '');
}
