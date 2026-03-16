// app/api/ops/attendance/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { attendance, schedules, users, stores, breakSessions } from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { getStoresForOps } from '@/lib/schedule-utils';
import * as XLSX from 'xlsx';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0);        return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999);   return r; }

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function lateMinutes(checkInIso: string | null | undefined, shift: string): number {
  if (!checkInIso) return 0;
  const dt = new Date(checkInIso);
  const threshold = new Date(dt);
  threshold.setHours(shift === 'morning' ? 8 : 13, 30, 0, 0);
  const diff = Math.floor((dt.getTime() - threshold.getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const thin = { style: 'thin' } as const;
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

const CENTER: XLSX.ExcelDataType = 'n'; // used for type clarity below
const centerAlign = { horizontal: 'center', vertical: 'center', wrapText: true  } as const;
const leftAlign   = { horizontal: 'left',   vertical: 'center', wrapText: false } as const;

const STYLES = {
  title: {
    font:      { name: 'Arial', bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '1E293B' }, patternType: 'solid' },
    alignment: centerAlign,
  },
  meta: {
    font:      { name: 'Arial', bold: false, sz: 9 },
    fill:      { fgColor: { rgb: 'F1F5F9' }, patternType: 'solid' },
    alignment: leftAlign,
  },
  metaBold: {
    font:      { name: 'Arial', bold: true, sz: 9 },
    fill:      { fgColor: { rgb: 'F1F5F9' }, patternType: 'solid' },
    alignment: leftAlign,
  },
  tableHeader: {
    font:      { name: 'Arial', bold: true,  sz: 10, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '6366F1' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    BORDER,
  },
  summaryLabel: {
    font:      { name: 'Arial', bold: true,  sz: 10, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '334155' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    BORDER,
  },
  summaryVal: {
    font:      { name: 'Arial', bold: true,  sz: 10, color: { rgb: '6366F1' } },
    fill:      { fgColor: { rgb: 'EEF2FF' }, patternType: 'solid' },
    alignment: centerAlign,
    border:    BORDER,
  },
} as const;

// Row fill colours per status
const STATUS_FILL: Record<string, string> = {
  present: 'F0FDF4',
  late:    'FFFBEB',
  absent:  'FEF2F2',
  excused: 'EFF6FF',
};

function rowStyle(status: string | null, col: number, colLetter: string) {
  const bg = STATUS_FILL[status ?? ''] ?? 'FFFFFF';
  return {
    font:      { name: 'Arial', sz: 9 },
    fill:      { fgColor: { rgb: bg }, patternType: 'solid' },
    alignment: ['A','E','F','G','H','I','J','K'].includes(colLetter) ? centerAlign : leftAlign,
    border:    BORDER,
  };
}

// ─── Cell helper ──────────────────────────────────────────────────────────────

function C(r: number, c: number) { return XLSX.utils.encode_cell({ r, c }); }

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

// ─── Row type ─────────────────────────────────────────────────────────────────

type ExportRow = {
  userId:       string;
  userName:     string;
  storeName:    string;
  date:         string;
  shift:        string;
  status:       string | null;
  checkInTime:  string | null;
  checkOutTime: string | null;
  breakOutTime: string | null;
  returnTime:   string | null;
  notes:        string | null;
};

// ─── Sheet 1: Full attendance log ─────────────────────────────────────────────

function buildLogSheet(
  ws: XLSX.WorkSheet,
  rows: ExportRow[],
  params: {
    storeName:  string;
    fromDate:   string;
    toDate:     string;
    exportedBy: string;
  },
) {
  const merges: XLSX.Range[] = [];
  const { storeName, fromDate, toDate, exportedBy } = params;

  ws['!cols'] = [
    { wch: 5  }, // A  No.
    { wch: 13 }, // B  Date
    { wch: 22 }, // C  Employee
    { wch: 20 }, // D  Store
    { wch: 9  }, // E  Shift
    { wch: 11 }, // F  Status
    { wch: 10 }, // G  Check-In
    { wch: 10 }, // H  Check-Out
    { wch: 11 }, // I  Break Out
    { wch: 11 }, // J  Break Return
    { wch: 12 }, // K  Late (min)
    { wch: 28 }, // L  Notes
  ];
  ws['!rows'] = [];

  // ── Row 0: Title ──────────────────────────────────────────────────────────
  cell(ws, C(0,0), 'ATTENDANCE REPORT', STYLES.title);
  merges.push({ s: { r:0, c:0 }, e: { r:0, c:11 } });
  ws['!rows'][0] = { hpt: 30 };

  // ── Row 1: Meta ───────────────────────────────────────────────────────────
  cell(ws, C(1,0), 'Store:',     STYLES.metaBold);
  cell(ws, C(1,1), storeName,    STYLES.meta);
  merges.push({ s: { r:1, c:1 }, e: { r:1, c:3 } });

  cell(ws, C(1,4), 'Period:',    STYLES.metaBold);
  cell(ws, C(1,5), `${fmtDate(fromDate + 'T00:00:00')}  –  ${fmtDate(toDate + 'T00:00:00')}`, STYLES.meta);
  merges.push({ s: { r:1, c:5 }, e: { r:1, c:7 } });

  cell(ws, C(1,8),  'Exported:',  STYLES.metaBold);
  cell(ws, C(1,9),  exportedBy,   STYLES.meta);
  merges.push({ s: { r:1, c:9 }, e: { r:1, c:11 } });
  ws['!rows'][1] = { hpt: 18 };

  // ── Row 2: spacer ─────────────────────────────────────────────────────────
  ws['!rows'][2] = { hpt: 5 };

  // ── Row 3: Column headers ─────────────────────────────────────────────────
  const HEADERS = ['No.','Date','Employee','Store','Shift','Status',
                   'Check-In','Check-Out','Break Out','Break Return','Late (min)','Notes'];
  HEADERS.forEach((h, i) => cell(ws, C(3, i), h, STYLES.tableHeader));
  ws['!rows'][3] = { hpt: 22 };

  // ── Rows 4+: Data ─────────────────────────────────────────────────────────
  const COL_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

  rows.forEach((row, idx) => {
    const r      = 4 + idx;
    const status = row.status;
    const late   = lateMinutes(row.checkInTime, row.shift);
    const shiftL = row.shift === 'morning' ? 'Morning' : row.shift === 'evening' ? 'Evening' : row.shift;
    const statusL = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
    const noWork  = status === 'absent' || status === 'excused';

    const values: (string | number | null)[] = [
      idx + 1,
      fmtDateLong(row.date),
      row.userName,
      row.storeName,
      shiftL,
      statusL,
      fmtTime(row.checkInTime)  || (noWork ? '' : '—'),
      fmtTime(row.checkOutTime) || (noWork ? '' : '—'),
      fmtTime(row.breakOutTime) || '—',
      fmtTime(row.returnTime)   || '—',
      late > 0 ? late : (noWork ? '' : 0),
      row.notes ?? '',
    ];

    values.forEach((val, ci) => {
      cell(ws, C(r, ci), val, rowStyle(status, ci, COL_LETTERS[ci]));
    });

    ws['!rows']![r] = { hpt: 18 };
  });

  // ── Summary footer ────────────────────────────────────────────────────────
  const sr = 4 + rows.length + 1;
  ws['!rows']![sr - 1] = { hpt: 6 }; // spacer

  const nPresent = rows.filter(r => r.status === 'present').length;
  const nLate    = rows.filter(r => r.status === 'late').length;
  const nAbsent  = rows.filter(r => r.status === 'absent').length;
  const nExcused = rows.filter(r => r.status === 'excused').length;

  cell(ws, C(sr,0), 'SUMMARY', STYLES.summaryLabel);
  merges.push({ s: { r:sr, c:0 }, e: { r:sr, c:3 } });

  cell(ws, C(sr,4), `Present: ${nPresent}`,   STYLES.summaryVal);
  cell(ws, C(sr,5), `Late: ${nLate}`,          STYLES.summaryVal);
  cell(ws, C(sr,6), `Absent: ${nAbsent}`,      STYLES.summaryVal);
  cell(ws, C(sr,7), `Excused: ${nExcused}`,    STYLES.summaryVal);
  cell(ws, C(sr,8), `Total: ${rows.length}`,   STYLES.summaryVal);
  merges.push({ s: { r:sr, c:9 }, e: { r:sr, c:11 } });
  ws['!rows']![sr] = { hpt: 22 };

  ws['!ref']    = XLSX.utils.encode_range({ s: { r:0, c:0 }, e: { r:sr, c:11 } });
  ws['!merges'] = merges;
}

// ─── Sheet 2: Per-employee pivot ──────────────────────────────────────────────

type EmpStat = {
  name: string; store: string;
  present: number; late: number; absent: number; excused: number;
};

function buildEmployeeSheet(ws: XLSX.WorkSheet, rows: ExportRow[]) {
  const merges: XLSX.Range[] = [];

  ws['!cols'] = [
    { wch: 24 }, // A Employee
    { wch: 20 }, // B Store
    { wch: 11 }, // C Total
    { wch: 10 }, // D Present
    { wch: 10 }, // E Late
    { wch: 10 }, // F Absent
    { wch: 10 }, // G Excused
    { wch: 10 }, // H Late %
  ];
  ws['!rows'] = [];

  // Title
  cell(ws, C(0,0), 'Attendance by Employee', STYLES.title);
  merges.push({ s: { r:0, c:0 }, e: { r:0, c:7 } });
  ws['!rows'][0] = { hpt: 26 };

  ws['!rows'][1] = { hpt: 5 };

  // Headers
  const HEADERS2 = ['Employee','Store','Total Days','Present','Late','Absent','Excused','Late %'];
  HEADERS2.forEach((h, i) => cell(ws, C(2, i), h, STYLES.tableHeader));
  ws['!rows'][2] = { hpt: 22 };

  // Aggregate
  const empMap = new Map<string, EmpStat>();
  for (const row of rows) {
    const key  = row.userId;
    const prev = empMap.get(key) ?? { name: row.userName, store: row.storeName,
                                       present: 0, late: 0, absent: 0, excused: 0 };
    const s = (row.status ?? 'absent') as keyof Pick<EmpStat,'present'|'late'|'absent'|'excused'>;
    if (s in prev) (prev[s] as number)++;
    empMap.set(key, prev);
  }

  const empList = [...empMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  empList.forEach((emp, idx) => {
    const r     = 3 + idx;
    const total = emp.present + emp.late + emp.absent + emp.excused;
    const latePct = total > 0 ? `${Math.round((emp.late / total) * 100)}%` : '0%';
    const alt   = idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF';

    const rowS = (isLeft: boolean) => ({
      font:      { name: 'Arial', sz: 9 },
      fill:      { fgColor: { rgb: alt }, patternType: 'solid' },
      alignment: isLeft ? leftAlign : centerAlign,
      border:    BORDER,
    });

    [emp.name, emp.store, total, emp.present, emp.late, emp.absent, emp.excused, latePct]
      .forEach((val, ci) => cell(ws, C(r, ci), val as string | number, rowS(ci < 2)));

    ws['!rows']![r] = { hpt: 18 };
  });

  const lastR = 3 + empList.length;
  ws['!ref']    = XLSX.utils.encode_range({ s: { r:0, c:0 }, e: { r: lastR, c:7 } });
  ws['!merges'] = merges;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fromDateParam = searchParams.get('fromDate');
    const toDateParam   = searchParams.get('toDate');
    const storeIdParam  = searchParams.get('storeId');
    const shiftParam    = searchParams.get('shift');
    const statusParam   = searchParams.get('status');

    if (!fromDateParam || !toDateParam) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
    }

    const fromDate = startOfDay(new Date(fromDateParam + 'T00:00:00'));
    const toDate   = endOfDay(new Date(toDateParam     + 'T00:00:00'));

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }
    if (fromDate > toDate) {
      return NextResponse.json({ error: 'fromDate must be before or equal to toDate' }, { status: 400 });
    }

    const diffDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
    if (diffDays > 90) {
      return NextResponse.json({ error: 'Date range cannot exceed 90 days' }, { status: 400 });
    }

    // ── OPS store scope ────────────────────────────────────────────────────
    const opsStoreIds = await getStoresForOps(session.user.id);
    if (!opsStoreIds.length) {
      return NextResponse.json({ error: 'No stores found for your area' }, { status: 403 });
    }

    const storeIds = storeIdParam && opsStoreIds.includes(storeIdParam)
      ? [storeIdParam]
      : opsStoreIds;

    // ── Query attendance ───────────────────────────────────────────────────
    const conditions = [
      inArray(attendance.storeId, storeIds),
      gte(attendance.date, fromDate),
      lte(attendance.date, toDate),
    ];
    if (shiftParam)  conditions.push(eq(attendance.shift,  shiftParam as any));
    if (statusParam) conditions.push(eq(attendance.status, statusParam as any));

    const rows = await db
      .select({
        att:   attendance,
        user:  { id: users.id,  name: users.name  },
        store: { id: stores.id, name: stores.name },
      })
      .from(attendance)
      .leftJoin(users,  eq(attendance.userId,  users.id))
      .leftJoin(stores, eq(attendance.storeId, stores.id))
      .where(and(...conditions))
      .orderBy(attendance.date, users.name);

    // First break session per attendance record
    const attIds = rows.map(r => r.att.id);
    const breaks = attIds.length
      ? await db
          .select()
          .from(breakSessions)
          .where(inArray(breakSessions.attendanceId, attIds))
      : [];

    const breakByAtt = new Map<string, typeof breaks[0]>();
    for (const b of breaks) {
      if (!breakByAtt.has(b.attendanceId)) breakByAtt.set(b.attendanceId, b);
    }

    // Store display name
    let storeName = 'All Stores';
    if (storeIds.length === 1) {
      const [s] = await db
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, storeIds[0]))
        .limit(1);
      if (s) storeName = s.name;
    }

    // ── Build export rows ──────────────────────────────────────────────────
    const exportRows: ExportRow[] = rows.map(({ att, user, store }) => {
      const brk = breakByAtt.get(att.id);
      return {
        userId:       att.userId,
        userName:     user?.name  ?? '—',
        storeName:    store?.name ?? '—',
        date:         att.date.toISOString(),
        shift:        att.shift,
        status:       att.status,
        checkInTime:  att.checkInTime?.toISOString()   ?? null,
        checkOutTime: att.checkOutTime?.toISOString()  ?? null,
        breakOutTime: brk?.breakOutTime?.toISOString() ?? null,
        returnTime:   brk?.returnTime?.toISOString()   ?? null,
        notes:        att.notes ?? null,
      };
    });

    // ── Build workbook ─────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    const ws1: XLSX.WorkSheet = {};
    buildLogSheet(ws1, exportRows, {
      storeName,
      fromDate:   fromDateParam,
      toDate:     toDateParam,
      exportedBy: (session.user as any).name ?? session.user.id,
    });
    XLSX.utils.book_append_sheet(wb, ws1, 'Attendance Log');

    const ws2: XLSX.WorkSheet = {};
    buildEmployeeSheet(ws2, exportRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'By Employee');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

    const filename = `attendance_${fromDateParam}_to_${toDateParam}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(buf.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/ops/attendance/export]', err);
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }
}