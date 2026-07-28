// app/api/pic/schedule/template/route.ts
//
// GET /api/pic/schedule/template?storeId=&yearMonth=YYYY-MM
//
// Generates a BLANK monthly schedule template (store's active roster,
// weekday header, date numbers — no shift codes filled in) so PIC/OPS can
// fill it in and re-upload via /api/pic/schedule/import. Column layout
// matches the import parser exactly (No / PIC / Name / date columns).
//
// Access: same as schedule management — canManageSchedule() from
// lib/schedule-utils.ts (admin, ops_ho/ops_area within their area, PIC 1/2
// for their own home store). PIC always gets their own store; storeId is
// only meaningful for OPS/admin.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq, and } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores, users, employeeTypes, userStoreAssignments } from '@/lib/db/schema';
import { canManageSchedule } from '@/lib/schedule-utils';
import XlsxStyle from 'xlsx-js-style';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

type Style = {
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
};

const THIN = { style: 'thin', color: { rgb: 'D1D5DB' } };
const THIN_DARK = { style: 'thin', color: { rgb: '94A3B8' } };
const border = (dark = false) => {
  const b = dark ? THIN_DARK : THIN;
  return { top: b, bottom: b, left: b, right: b };
};
const solid = (hex: string) => ({ patternType: 'solid', fgColor: { rgb: hex } });
const CENTER = { horizontal: 'center', vertical: 'center' };
const LEFT = { horizontal: 'left', vertical: 'center' };
const FONT_BASE = { name: 'Arial', sz: 9 };
const FONT_BOLD = { name: 'Arial', sz: 9, bold: true };

function addr(r: number, c: number) {
  return XlsxStyle.utils.encode_cell({ r, c });
}

function sc(ws: XlsxStyle.WorkSheet, r: number, c: number, value: string | number | null, style: Style) {
  ws[addr(r, c)] = { v: value ?? '', t: typeof value === 'number' ? 'n' : 's', s: style };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actorId = session.user.id as string;
  const rawHomeStoreId = session.user.homeStoreId as number | string | null | undefined;
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');
  const rawStoreId = req.nextUrl.searchParams.get('storeId');

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ success: false, error: 'yearMonth (YYYY-MM) is required.' }, { status: 400 });
  }

  const storeId = rawStoreId ? Number(rawStoreId) : rawHomeStoreId != null ? Number(rawHomeStoreId) : NaN;
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  const auth = await canManageSchedule(actorId, storeId);
  if (!auth.allowed) {
    return NextResponse.json({ success: false, error: auth.reason ?? 'Forbidden.' }, { status: 403 });
  }

  const [storeRow] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!storeRow) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  const roster = await db
    .select({
      userId: users.id,
      name: users.name,
      empTypeCode: employeeTypes.code,
      empTypeLabel: employeeTypes.label,
    })
    .from(userStoreAssignments)
    .innerJoin(users, eq(userStoreAssignments.userId, users.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(and(eq(userStoreAssignments.storeId, storeId), eq(userStoreAssignments.isActive, true), eq(users.isActive, true)))
    .orderBy(users.name);

  const PIC_ORDER: Record<string, number> = { pic_1: 0, pic_2: 1, sa: 2 };
  const empList = [...roster].sort((a, b) => {
    const pa = PIC_ORDER[a.empTypeCode ?? ''] ?? 99;
    const pb = PIC_ORDER[b.empTypeCode ?? ''] ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });

  const [year, month] = yearMonth.split('-').map(Number);
  const totalDays = daysInMonth(year, month);
  const monthShort = `${MONTHS_SHORT[month - 1]}-${year}`;
  const totalCols = 3 + totalDays;

  const ws: XlsxStyle.WorkSheet = {};
  const merges: XlsxStyle.Range[] = [];

  // Title banner
  const titleStyle: Style = {
    font: { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
    fill: solid('1E293B'), alignment: LEFT, border: border(true),
  };
  sc(ws, 0, 0, storeRow.name.toUpperCase(), titleStyle);
  for (let c = 1; c < totalCols; c++) sc(ws, 0, c, '', titleStyle);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

  // Month row
  const monthLabelStyle: Style = { font: { ...FONT_BOLD, color: { rgb: '64748B' } }, fill: solid('F1F5F9'), alignment: LEFT, border: border() };
  const monthValStyle: Style = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '4F46E5' } }, fill: solid('EEF2FF'), alignment: CENTER, border: border(true) };
  sc(ws, 1, 0, 'MONTH :', monthLabelStyle);
  sc(ws, 1, 1, '', monthLabelStyle);
  sc(ws, 1, 2, '', monthLabelStyle);
  sc(ws, 1, 3, monthShort, monthValStyle);
  for (let c = 4; c < totalCols; c++) sc(ws, 1, c, '', monthLabelStyle);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });

  // Weekday header + date numbers
  const headerStyle: Style = { font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } }, fill: solid('334155'), alignment: CENTER, border: border(true) };
  const dayHeaderStyle = (dow: number): Style => ({
    font: { ...FONT_BOLD, color: { rgb: dow === 0 || dow === 6 ? 'FCA5A5' : 'E2E8F0' } },
    fill: solid('334155'), alignment: CENTER, border: border(true),
  });
  const dateNumStyle = (dow: number): Style => ({
    font: { ...FONT_BOLD, color: { rgb: dow === 0 || dow === 6 ? 'EF4444' : '475569' } },
    fill: solid(dow === 0 || dow === 6 ? 'FFF1F2' : 'F8FAFC'), alignment: CENTER, border: border(),
  });

  sc(ws, 2, 0, 'No', headerStyle);
  sc(ws, 2, 1, 'PIC', headerStyle);
  sc(ws, 2, 2, 'Name', headerStyle);
  sc(ws, 3, 0, '', { font: FONT_BASE, fill: solid('F8FAFC'), alignment: LEFT, border: border() });
  sc(ws, 3, 1, '', { font: FONT_BASE, fill: solid('F8FAFC'), alignment: LEFT, border: border() });
  sc(ws, 3, 2, '', { font: FONT_BASE, fill: solid('F8FAFC'), alignment: LEFT, border: border() });

  for (let day = 1; day <= totalDays; day++) {
    const col = 3 + (day - 1);
    const dow = new Date(year, month - 1, day).getDay();
    sc(ws, 2, col, WEEKDAYS[dow], dayHeaderStyle(dow));
    sc(ws, 3, col, day, dateNumStyle(dow));
  }

  // Employee rows — roster pre-filled, every day cell left blank to fill in
  const blankCellStyle: Style = { font: FONT_BASE, fill: solid('FFFFFF'), alignment: CENTER, border: border() };
  empList.forEach((emp, idx) => {
    const r = 4 + idx;
    const alt = idx % 2 === 1;
    const rowStyle: Style = { font: { ...FONT_BASE, color: { rgb: '1E293B' } }, fill: solid(alt ? 'F8FAFC' : 'FFFFFF'), alignment: LEFT, border: border() };
    sc(ws, r, 0, idx + 1, { ...rowStyle, alignment: CENTER });
    sc(ws, r, 1, emp.empTypeLabel || emp.empTypeCode || '', rowStyle);
    sc(ws, r, 2, emp.name.toUpperCase(), rowStyle);
    for (let day = 1; day <= totalDays; day++) {
      sc(ws, r, 3 + (day - 1), '', blankCellStyle);
    }
  });

  // Legend
  const legendRow = 4 + empList.length + 1;
  const legendStyle: Style = {
    font: { name: 'Arial', sz: 8, italic: true, color: { rgb: '94A3B8' } },
    fill: solid('FFFFFF'), alignment: LEFT, border: { bottom: { style: 'thin', color: { rgb: 'E2E8F0' } } },
  };
  sc(ws, legendRow, 0, 'Fill in: E = Morning  |  L = Evening  |  F = Full Day  |  AL = Leave  |  leave blank = Day Off', legendStyle);
  for (let c = 1; c < totalCols; c++) sc(ws, legendRow, c, '', legendStyle);
  merges.push({ s: { r: legendRow, c: 0 }, e: { r: legendRow, c: totalCols - 1 } });

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: legendRow, c: totalCols - 1 } });
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 5 }, { wch: 9 }, { wch: 24 }, ...Array(totalDays).fill(null).map(() => ({ wch: 4.5 }))];
  ws['!freeze'] = { xSplit: 3, ySplit: 4, topLeftCell: 'D5' };

  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, ws, monthShort);
  const buf = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const filename = `schedule_template_${storeRow.name.replace(/[^a-zA-Z0-9]/g, '_')}_${yearMonth}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
    },
  });
}
