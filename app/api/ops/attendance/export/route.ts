// app/api/ops/attendance/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { schedules, attendance, users, stores } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { canManageSchedule } from '@/lib/schedule-utils';
import * as XLSX from 'xlsx';

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const WEEKDAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function weekdayName(iso: string): string {
  return WEEKDAYS_ID[new Date(iso).getDay()];
}

function lateMinutes(checkInIso: string | null, shift: string): number {
  if (!checkInIso) return 0;
  const dt = new Date(checkInIso);
  const threshold = new Date(dt);
  threshold.setHours(shift === 'morning' ? 8 : 13, 30, 0, 0);
  const diff = Math.floor((dt.getTime() - threshold.getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

function keterangan(status: string | null, notes: string | null): string {
  const map: Record<string, string> = {
    present: 'Hadir',
    late:    'Terlambat',
    absent:  'Tidak Hadir',
    excused: 'Izin',
  };
  const base = status ? (map[status] ?? status) : '—';
  return notes ? `${base} – ${notes}` : base;
}

// ─── Style objects ────────────────────────────────────────────────────────────
const thinBorder = {
  top:    { style: 'thin' },
  bottom: { style: 'thin' },
  left:   { style: 'thin' },
  right:  { style: 'thin' },
};

const centerAlign = { horizontal: 'center', vertical: 'center', wrapText: true };
const leftAlign   = { horizontal: 'left',   vertical: 'center', wrapText: true };

const STYLES = {
  title: {
    font:      { name: 'Arial', bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '1F4E79' }, patternType: 'solid' },
    alignment: centerAlign,
  },
  metaLabel: {
    font:      { name: 'Arial', bold: true, sz: 10 },
    alignment: leftAlign,
  },
  metaVal: {
    font:      { name: 'Arial', sz: 10 },
    alignment: leftAlign,
  },
  tableHeader: {
    font:      { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '2E75B6' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    thinBorder,
  },
  summaryLabel: {
    font:      { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '1F4E79' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    thinBorder,
  },
  summaryVal: {
    font:      { name: 'Arial', bold: true, sz: 10 },
    fill:      { fgColor: { rgb: 'BDD7EE' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    thinBorder,
  },
};

function rowDataStyle(status: string | null, rowIdx: number, center = true) {
  let fillColor = rowIdx % 2 === 0 ? 'DEEAF1' : 'FFFFFF';
  if (status === 'absent') fillColor = 'FFCCCC';
  if (status === 'late')   fillColor = 'FFF2CC';
  return {
    font:      { name: 'Arial', sz: 10 },
    fill:      { fgColor: { rgb: fillColor }, patternType: 'solid' },
    alignment: center ? centerAlign : leftAlign,
    border:    thinBorder,
  };
}

// ─── Cell writer ──────────────────────────────────────────────────────────────
function C(r: number, c: number) {
  return XLSX.utils.encode_cell({ r, c });
}

function cell(
  ws: XLSX.WorkSheet,
  addr: string,
  value: string | number | null,
  style: object,
) {
  ws[addr] = {
    v: value ?? '',
    t: typeof value === 'number' ? 'n' : 's',
    s: style,
  };
}

// ─── Build one worksheet ──────────────────────────────────────────────────────
type EmpRecord = {
  date:         string;
  shift:        string;
  status:       string | null;
  checkInTime:  string | null;
  checkOutTime: string | null;
  notes:        string | null;
};

function buildSheet(ws: XLSX.WorkSheet, params: {
  storeName:    string;
  month:        string;
  year:         string;
  name:         string;
  nik:          string;
  employeeType: string;
  records:      EmpRecord[];
}) {
  const { storeName, month, year, name, nik, employeeType, records } = params;
  const merges: XLSX.Range[] = [];

  ws['!cols'] = [
    { wch: 5  }, // A No.
    { wch: 12 }, // B Tanggal
    { wch: 11 }, // C Hari
    { wch: 11 }, // D Shift
    { wch: 11 }, // E Jam Masuk
    { wch: 11 }, // F Jam Pulang
    { wch: 13 }, // G Telat (Menit)
    { wch: 30 }, // H Keterangan
  ];
  ws['!rows'] = [];

  // Row 1 — Title
  cell(ws, C(0, 0), 'BUKU ABSEN MANUAL', STYLES.title);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });
  ws['!rows'][0] = { hpt: 28 };

  // Row 2 — CABANG / BULAN / TAHUN
  cell(ws, C(1, 0), 'CABANG:', STYLES.metaLabel);
  cell(ws, C(1, 2), storeName,  STYLES.metaVal);
  cell(ws, C(1, 4), 'BULAN:',  STYLES.metaLabel);
  cell(ws, C(1, 5), month,      STYLES.metaVal);
  cell(ws, C(1, 6), 'TAHUN:',  STYLES.metaLabel);
  cell(ws, C(1, 7), year,       STYLES.metaVal);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  ws['!rows'][1] = { hpt: 18 };

  // Row 3 — NAMA / NIK / STATUS
  cell(ws, C(2, 0), 'NAMA:',   STYLES.metaLabel);
  cell(ws, C(2, 2), name,       STYLES.metaVal);
  cell(ws, C(2, 4), 'NIK:',    STYLES.metaLabel);
  cell(ws, C(2, 5), nik,        STYLES.metaVal);
  cell(ws, C(2, 6), 'STATUS:', STYLES.metaLabel);
  cell(ws, C(2, 7), employeeType.toUpperCase(), STYLES.metaVal);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } });
  merges.push({ s: { r: 2, c: 2 }, e: { r: 2, c: 3 } });
  ws['!rows'][2] = { hpt: 18 };

  // Row 4 — blank spacer
  ws['!rows'][3] = { hpt: 6 };

  // Row 5 — Table headers
  const HEADERS = ['No.', 'Tanggal', 'Hari', 'Shift', 'Jam Masuk', 'Jam Pulang', 'Telat (Menit)', 'Keterangan'];
  HEADERS.forEach((h, i) => cell(ws, C(4, i), h, STYLES.tableHeader));
  ws['!rows'][4] = { hpt: 22 };

  // Data rows
  records.forEach((rec, idx) => {
    const r      = 5 + idx;
    const status = rec.status;
    const late   = lateMinutes(rec.checkInTime, rec.shift);
    const shiftL = rec.shift === 'morning' ? 'Pagi' : rec.shift === 'evening' ? 'Sore' : rec.shift;

    const notAbsentOrExcused = status !== 'absent' && status !== 'excused';

    cell(ws, C(r, 0), idx + 1,            rowDataStyle(status, idx, true));
    cell(ws, C(r, 1), fmtDate(rec.date),  rowDataStyle(status, idx, true));
    cell(ws, C(r, 2), weekdayName(rec.date), rowDataStyle(status, idx, true));
    cell(ws, C(r, 3), shiftL,             rowDataStyle(status, idx, true));
    cell(ws, C(r, 4), fmtTime(rec.checkInTime)  || (notAbsentOrExcused ? '—' : ''), rowDataStyle(status, idx, true));
    cell(ws, C(r, 5), fmtTime(rec.checkOutTime) || (notAbsentOrExcused ? '—' : ''), rowDataStyle(status, idx, true));
    cell(ws, C(r, 6), late > 0 ? late : (notAbsentOrExcused ? '—' : ''),            rowDataStyle(status, idx, true));
    cell(ws, C(r, 7), keterangan(status, rec.notes), rowDataStyle(status, idx, false));
    ws['!rows']![r] = { hpt: 18 };
  });

  // Summary row
  const sr       = 5 + records.length;
  const nPresent = records.filter((r) => r.status === 'present').length;
  const nLate    = records.filter((r) => r.status === 'late').length;
  const nAbsent  = records.filter((r) => r.status === 'absent').length;
  const nExcused = records.filter((r) => r.status === 'excused').length;

  // Merged label cells A–D
  for (let c = 0; c < 4; c++) {
    cell(ws, C(sr, c), c === 0 ? 'RINGKASAN' : '', STYLES.summaryLabel);
  }
  merges.push({ s: { r: sr, c: 0 }, e: { r: sr, c: 3 } });

  cell(ws, C(sr, 4), `Hadir: ${nPresent}`,        STYLES.summaryVal);
  cell(ws, C(sr, 5), `Terlambat: ${nLate}`,        STYLES.summaryVal);
  cell(ws, C(sr, 6), `Izin: ${nExcused}`,          STYLES.summaryVal);
  cell(ws, C(sr, 7), `Tidak Hadir: ${nAbsent}`,    STYLES.summaryVal);
  ws['!rows']![sr] = { hpt: 20 };

  ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sr, c: 7 } });
  ws['!merges'] = merges;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const actorId = (session.user as any).id as string;
    const storeId = req.nextUrl.searchParams.get('storeId');
    const dateStr = req.nextUrl.searchParams.get('date');

    if (!storeId || !dateStr) {
      return NextResponse.json({ success: false, error: 'storeId and date are required' }, { status: 400 });
    }

    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) {
      return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
    }

    const date       = new Date(dateStr);
    const monthStart = startOfMonth(date);
    const monthEnd   = endOfMonth(date);

    const [store] = await db
      .select({ name: stores.name })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!store) {
      return NextResponse.json({ success: false, error: 'Store not found' }, { status: 404 });
    }

    const rows = await db
      .select({ schedule: schedules, user: users, attendance })
      .from(schedules)
      .leftJoin(users,      eq(schedules.userId,      users.id))
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          eq(schedules.storeId,   storeId),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     monthStart),
          lte(schedules.date,     monthEnd),
        ),
      )
      .orderBy(users.name, schedules.date, schedules.shift);

    // Group by employee
    const employeeMap = new Map<string, {
      name: string; nik: string; employeeType: string; records: EmpRecord[];
    }>();

    for (const { schedule, user, attendance: att } of rows) {
      if (!user) continue;
      const entry = employeeMap.get(user.id) ?? {
        name:         user.name,
        nik:          user.id.slice(0, 8).toUpperCase(),
        employeeType: user.employeeType ?? '',
        records:      [],
      };
      entry.records.push({
        date:         schedule.date.toISOString(),
        shift:        schedule.shift,
        status:       att?.status     ?? null,
        checkInTime:  att?.checkInTime?.toISOString()  ?? null,
        checkOutTime: att?.checkOutTime?.toISOString() ?? null,
        notes:        att?.notes ?? null,
      });
      employeeMap.set(user.id, entry);
    }

    if (employeeMap.size === 0) {
      return NextResponse.json(
        { success: false, error: 'No scheduled employees found for this month' },
        { status: 404 },
      );
    }

    const monthLabel = MONTH_NAMES_ID[date.getMonth()];
    const yearLabel  = String(date.getFullYear());

    const wb = XLSX.utils.book_new();

    let sheetIdx = 0;
    for (const [, emp] of employeeMap) {
      const ws: XLSX.WorkSheet = {};
      buildSheet(ws, {
        storeName:    store.name,
        month:        monthLabel,
        year:         yearLabel,
        name:         emp.name,
        nik:          emp.nik,
        employeeType: emp.employeeType,
        records:      emp.records,
      });
      // Sheet names: max 31 chars, must be unique
      const sheetName = emp.name.slice(0, 28) + (sheetIdx > 0 ? ` ${sheetIdx}` : '');
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      sheetIdx++;
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

    const filename = `absen_${store.name.replace(/\s+/g, '_')}_${monthLabel}_${yearLabel}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('export error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}