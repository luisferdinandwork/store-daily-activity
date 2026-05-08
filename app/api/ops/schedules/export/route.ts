// app/api/ops/schedules/export/route.ts
//
// Exports the monthly schedule as a styled Excel file that:
//   1. Matches the import template layout so it can be re-imported
//   2. Uses xlsx-js-style for cell colors, borders, and fonts
//
// Install: npm install xlsx-js-style
//
// Layout (0-based rows):
//   0   : Title banner — store name (merged across all columns)
//   1   : "MONTH :" label + "May-2026" value
//   2   : Column headers — No / PIC / Name / SUN / MON / … (weekday per date)
//   3   : Date numbers — 1, 2, 3, … , daysInMonth
//   4+  : Employee rows — No / PIC / Name / E | L | F | AL | OFF per day
//   last: Summary rows — MORNING / EVENING / FULL DAY / OFF/CUTI counts
//
// Color palette (matches the web app):
//   Morning  E  → orange  bg #FFF7ED  text #C2410C
//   Evening  L  → purple  bg #F5F3FF  text #6D28D9
//   Full Day F  → green   bg #F0FDF4  text #15803D
//   Leave    AL → indigo  bg #EEF2FF  text #3730A3
//   Off      OFF→ slate   bg #F8FAFC  text #94A3B8

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  monthlySchedules, monthlyScheduleEntries,
  stores, users, employeeTypes, shifts,
} from '@/lib/db/schema';
import { eq, and }       from 'drizzle-orm';
import { getStoresForOps } from '@/lib/schedule-utils';
// xlsx-js-style is a drop-in replacement for xlsx that supports cell.s (styles)
import XlsxStyle from 'xlsx-js-style';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS    = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Shift code helpers ───────────────────────────────────────────────────────

function toExcelCode(shiftCode: string | null, isOff: boolean, isLeave: boolean): string {
  if (isLeave)                  return 'AL';
  if (isOff || !shiftCode)      return 'OFF';
  if (shiftCode === 'morning')  return 'E';
  if (shiftCode === 'evening')  return 'L';
  if (shiftCode === 'full_day') return 'F';
  return 'OFF';
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ─── Style helpers ────────────────────────────────────────────────────────────

type XlsxStyle = {
  font?:      Record<string, unknown>;
  fill?:      Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?:    Record<string, unknown>;
};

const THIN = { style: 'thin', color: { rgb: 'D1D5DB' } };
const THIN_DARK = { style: 'thin', color: { rgb: '94A3B8' } };

function border(dark = false) {
  const b = dark ? THIN_DARK : THIN;
  return { top: b, bottom: b, left: b, right: b };
}

function solid(hex: string) {
  return { patternType: 'solid', fgColor: { rgb: hex } };
}

const CENTER: Record<string, unknown>   = { horizontal: 'center', vertical: 'center', wrapText: false };
const LEFT: Record<string, unknown>     = { horizontal: 'left',   vertical: 'center', wrapText: false };
const FONT_BASE = { name: 'Arial', sz: 9 };
const FONT_BOLD = { name: 'Arial', sz: 9,  bold: true };
const FONT_SM   = { name: 'Arial', sz: 8 };

// Per-code cell style — background + text color matching web UI
const CODE_STYLE: Record<string, XlsxStyle> = {
  E: {
    font:      { ...FONT_BOLD, color: { rgb: 'C2410C' } },
    fill:      solid('FFF7ED'),
    alignment: CENTER,
    border:    border(),
  },
  L: {
    font:      { ...FONT_BOLD, color: { rgb: '6D28D9' } },
    fill:      solid('F5F3FF'),
    alignment: CENTER,
    border:    border(),
  },
  F: {
    font:      { ...FONT_BOLD, color: { rgb: '15803D' } },
    fill:      solid('F0FDF4'),
    alignment: CENTER,
    border:    border(),
  },
  AL: {
    font:      { ...FONT_BOLD, color: { rgb: '3730A3' } },
    fill:      solid('EEF2FF'),
    alignment: CENTER,
    border:    border(),
  },
  OFF: {
    font:      { ...FONT_SM, color: { rgb: 'CBD5E1' } },
    fill:      solid('F8FAFC'),
    alignment: CENTER,
    border:    border(),
  },
};

// Row shading for employee rows (alternating)
function empRowStyle(alt: boolean): XlsxStyle {
  return {
    font:      { ...FONT_BASE, color: { rgb: '1E293B' } },
    fill:      solid(alt ? 'F8FAFC' : 'FFFFFF'),
    alignment: LEFT,
    border:    border(),
  };
}
function empNumStyle(alt: boolean): XlsxStyle {
  return { ...empRowStyle(alt), alignment: CENTER };
}

// ─── Cell writer ──────────────────────────────────────────────────────────────

function addr(r: number, c: number) { return XlsxStyle.utils.encode_cell({ r, c }); }

function sc(
  ws: XlsxStyle.WorkSheet,
  r: number, c: number,
  value: string | number | null,
  style: XlsxStyle,
) {
  if (value === null || value === undefined) {
    ws[addr(r, c)] = { v: '', t: 's', s: style };
    return;
  }
  ws[addr(r, c)] = {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: style,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const storeIdParam   = searchParams.get('storeId');
    const yearMonthParam = searchParams.get('yearMonth'); // "YYYY-MM"

    if (!storeIdParam || !yearMonthParam) {
      return NextResponse.json({ error: 'storeId and yearMonth are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}$/.test(yearMonthParam)) {
      return NextResponse.json({ error: 'yearMonth must be YYYY-MM' }, { status: 400 });
    }

    const storeId = Number(storeIdParam);
    if (isNaN(storeId)) {
      return NextResponse.json({ error: 'Invalid storeId' }, { status: 400 });
    }

    // Auth — store must be in the OPS user's area
    const opsStoreIds = await getStoresForOps((session.user as any).id as string);
    if (!opsStoreIds.includes(storeId)) {
      return NextResponse.json({ error: 'Store is not in your area' }, { status: 403 });
    }

    // ── Load schedule ──────────────────────────────────────────────────────

    const [ms] = await db
      .select()
      .from(monthlySchedules)
      .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonthParam)))
      .limit(1);

    if (!ms) {
      return NextResponse.json({ error: `No schedule found for ${yearMonthParam}` }, { status: 404 });
    }

    const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1);
    const storeName  = storeRow?.name ?? `Store ${storeId}`;

    // ── Load entries ───────────────────────────────────────────────────────

    const rawEntries = await db
      .select({
        entry:        monthlyScheduleEntries,
        userName:     users.name,
        empTypeCode:  employeeTypes.code,
        empTypeLabel: employeeTypes.label,
        shiftCode:    shifts.code,
      })
      .from(monthlyScheduleEntries)
      .leftJoin(users,         eq(monthlyScheduleEntries.userId,  users.id))
      .leftJoin(employeeTypes, eq(users.employeeTypeId,           employeeTypes.id))
      .leftJoin(shifts,        eq(monthlyScheduleEntries.shiftId, shifts.id))
      .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id))
      .orderBy(monthlyScheduleEntries.userId, monthlyScheduleEntries.date);

    // ── Build employee map ─────────────────────────────────────────────────

    const [year, month] = yearMonthParam.split('-').map(Number);
    const totalDays     = daysInMonth(year, month);
    const monthShort    = `${MONTHS_SHORT[month - 1]}-${year}`;

    interface EmpInfo {
      userId:   string;
      name:     string;
      picCode:  string;
      picLabel: string;
      days:     Record<number, string>;
    }

    const empMap = new Map<string, EmpInfo>();

    for (const row of rawEntries) {
      const { entry, userName, empTypeCode, empTypeLabel, shiftCode } = row;
      const date       = new Date(entry.date);
      const dayOfMonth = date.getUTCDate() || date.getDate();
      const code       = toExcelCode(shiftCode, entry.isOff, entry.isLeave);

      if (!empMap.has(entry.userId)) {
        empMap.set(entry.userId, {
          userId:   entry.userId,
          name:     userName ?? entry.userId,
          picCode:  empTypeCode  ?? '',
          picLabel: empTypeLabel ?? '',
          days:     {},
        });
      }
      empMap.get(entry.userId)!.days[dayOfMonth] = code;
    }

    const PIC_ORDER: Record<string, number> = { pic_1: 0, pic_2: 1, so: 2 };
    const empList = [...empMap.values()].sort((a, b) => {
      const pa = PIC_ORDER[a.picCode] ?? 99;
      const pb = PIC_ORDER[b.picCode] ?? 99;
      return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
    });

    // ── Build worksheet ────────────────────────────────────────────────────

    const ws: XlsxStyle.WorkSheet = {};
    const merges: XlsxStyle.Range[] = [];
    const totalCols = 3 + totalDays; // No + PIC + Name + day columns

    // ── Row 0: Title banner ────────────────────────────────────────────────
    const titleStyle: XlsxStyle = {
      font:      { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
      fill:      solid('1E293B'),
      alignment: { horizontal: 'left', vertical: 'center' },
      border:    border(true),
    };
    sc(ws, 0, 0, storeName.toUpperCase(), titleStyle);
    // Fill rest of title row with same style (blank cells) so border continues
    for (let c = 1; c < totalCols; c++) sc(ws, 0, c, '', titleStyle);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

    // ── Row 1: Month row ───────────────────────────────────────────────────
    const monthLabelStyle: XlsxStyle = {
      font:      { ...FONT_BOLD, color: { rgb: '64748B' } },
      fill:      solid('F1F5F9'),
      alignment: LEFT,
      border:    border(),
    };
    const monthValStyle: XlsxStyle = {
      font:      { name: 'Arial', sz: 10, bold: true, color: { rgb: '4F46E5' } },
      fill:      solid('EEF2FF'),
      alignment: CENTER,
      border:    border(true),
    };
    sc(ws, 1, 0, 'MONTH :', monthLabelStyle);
    sc(ws, 1, 1, '', monthLabelStyle);
    sc(ws, 1, 2, '', monthLabelStyle);
    sc(ws, 1, 3, monthShort, monthValStyle);
    for (let c = 4; c < totalCols; c++) sc(ws, 1, c, '', monthLabelStyle);
    // Merge A2:C2 for the "MONTH :" label
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });

    // ── Row 2: Weekday header row ──────────────────────────────────────────
    const fixedHeaderStyle: XlsxStyle = {
      font:      { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
      fill:      solid('334155'),
      alignment: CENTER,
      border:    border(true),
    };

    // Weekend columns get a slightly different shade
    function dayHeaderStyle(dow: number): XlsxStyle {
      const isWkd = dow === 0 || dow === 6;
      return {
        font:      { ...FONT_BOLD, color: { rgb: isWkd ? 'FCA5A5' : 'E2E8F0' } },
        fill:      solid('334155'),
        alignment: CENTER,
        border:    border(true),
      };
    }

    sc(ws, 2, 0, 'No',   fixedHeaderStyle);
    sc(ws, 2, 1, 'PIC',  fixedHeaderStyle);
    sc(ws, 2, 2, 'Name', fixedHeaderStyle);

    // ── Row 3: Date numbers ────────────────────────────────────────────────
    function dateNumStyle(dow: number): XlsxStyle {
      const isWkd = dow === 0 || dow === 6;
      return {
        font:      { ...FONT_BOLD, color: { rgb: isWkd ? 'EF4444' : '475569' } },
        fill:      solid(isWkd ? 'FFF1F2' : 'F8FAFC'),
        alignment: CENTER,
        border:    border(),
      };
    }

    const fixedDateCellStyle: XlsxStyle = {
      font:  FONT_BASE,
      fill:  solid('F8FAFC'),
      alignment: LEFT,
      border: border(),
    };
    sc(ws, 3, 0, '', fixedDateCellStyle);
    sc(ws, 3, 1, '', fixedDateCellStyle);
    sc(ws, 3, 2, '', fixedDateCellStyle);

    for (let day = 1; day <= totalDays; day++) {
      const col = 3 + (day - 1);
      const dow = new Date(year, month - 1, day).getDay();
      sc(ws, 2, col, WEEKDAYS[dow], dayHeaderStyle(dow));
      sc(ws, 3, col, day,           dateNumStyle(dow));
    }

    // ── Rows 4+: Employee rows ─────────────────────────────────────────────
    empList.forEach((emp, idx) => {
      const r   = 4 + idx;
      const alt = idx % 2 === 1;

      sc(ws, r, 0, idx + 1,                          empNumStyle(alt));
      sc(ws, r, 1, emp.picLabel || emp.picCode || '', empRowStyle(alt));
      sc(ws, r, 2, emp.name.toUpperCase(),            empRowStyle(alt));

      for (let day = 1; day <= totalDays; day++) {
        const col  = 3 + (day - 1);
        const code = emp.days[day] ?? 'OFF';
        sc(ws, r, col, code, CODE_STYLE[code] ?? CODE_STYLE.OFF);
      }
    });

    // ── Summary rows ───────────────────────────────────────────────────────

    const summaryRow = 4 + empList.length;

    // One blank separator row (light gray full-width)
    const separatorStyle: XlsxStyle = {
      font: FONT_BASE,
      fill: solid('E2E8F0'),
      alignment: CENTER,
      border: border(),
    };
    for (let c = 0; c < totalCols; c++) sc(ws, summaryRow, c, '', separatorStyle);

    const SUMMARY_DEF = [
      { label: 'MORNING',  code: 'E',   bg: 'FFF7ED', text: 'C2410C', countBg: 'FED7AA' },
      { label: 'EVENING',  code: 'L',   bg: 'F5F3FF', text: '6D28D9', countBg: 'DDD6FE' },
      { label: 'FULL DAY', code: 'F',   bg: 'F0FDF4', text: '15803D', countBg: 'BBF7D0' },
      { label: 'OFF/CUTI', code: 'OFF', bg: 'F8FAFC', text: '94A3B8', countBg: 'E2E8F0' },
    ];

    SUMMARY_DEF.forEach(({ label, code, bg, text, countBg }, si) => {
      const r = summaryRow + 1 + si;

      const labelStyle: XlsxStyle = {
        font:      { ...FONT_BOLD, color: { rgb: text } },
        fill:      solid(bg),
        alignment: LEFT,
        border:    border(),
      };

      sc(ws, r, 0, label, labelStyle);
      sc(ws, r, 1, '',    labelStyle);
      sc(ws, r, 2, '',    labelStyle);
      merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });

      // Count per day
      for (let day = 1; day <= totalDays; day++) {
        const col   = 3 + (day - 1);
        let count   = 0;
        for (const emp of empList) {
          const c2 = emp.days[day] ?? 'OFF';
          if (c2 === code) count++;
        }
        sc(ws, r, col, count > 0 ? count : '', {
          font:      { ...FONT_BOLD, color: { rgb: text } },
          fill:      solid(count > 0 ? countBg : bg),
          alignment: CENTER,
          border:    border(),
        });
      }
    });

    // ── Legend row ─────────────────────────────────────────────────────────

    const legendRow = summaryRow + 1 + SUMMARY_DEF.length + 1;
    const legendStyle: XlsxStyle = {
      font:      { name: 'Arial', sz: 8, italic: true, color: { rgb: '94A3B8' } },
      fill:      solid('FFFFFF'),
      alignment: LEFT,
      border:    { bottom: { style: 'thin', color: { rgb: 'E2E8F0' } } },
    };
    sc(ws, legendRow, 0, 'E = Morning  |  L = Evening  |  F = Full Day  |  AL = Leave  |  OFF = Day Off', legendStyle);
    for (let c = 1; c < totalCols; c++) sc(ws, legendRow, c, '', legendStyle);
    merges.push({ s: { r: legendRow, c: 0 }, e: { r: legendRow, c: totalCols - 1 } });

    // ── Worksheet meta ─────────────────────────────────────────────────────

    const lastRow = legendRow;
    const lastCol = totalCols - 1;
    ws['!ref']    = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
    ws['!merges'] = merges;

    ws['!cols'] = [
      { wch: 5  },  // No
      { wch: 9  },  // PIC
      { wch: 24 },  // Name
      ...Array(totalDays).fill(null).map(() => ({ wch: 4.5 })),
    ];

    ws['!rows'] = [
      { hpt: 24 },   // title
      { hpt: 18 },   // month
      { hpt: 18 },   // weekday header
      { hpt: 16 },   // date numbers
      ...empList.map(() => ({ hpt: 16 })),
      { hpt: 6  },   // separator
      { hpt: 16 }, { hpt: 16 }, { hpt: 16 }, { hpt: 16 },  // summaries
      { hpt: 6  },   // gap
      { hpt: 14 },   // legend
    ];

    // Freeze panes — lock the first 3 cols + 4 header rows while scrolling
    ws['!freeze'] = { xSplit: 3, ySplit: 4, topLeftCell: 'D5' };

    // ── Build workbook ─────────────────────────────────────────────────────

    const wb = XlsxStyle.utils.book_new();
    XlsxStyle.utils.book_append_sheet(wb, ws, monthShort);

    const buf      = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const filename = `schedule_${storeName.replace(/[^a-zA-Z0-9]/g, '_')}_${yearMonthParam}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(buf.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/ops/schedules/export]', err);
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }
}