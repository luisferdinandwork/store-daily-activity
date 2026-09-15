// app/api/it/users/template/route.ts
//
// GET /api/it/users/template            → blank template (1 example row)
// GET /api/it/users/template?mode=current → every existing user, prefilled
//
// Both produce the same "Users" sheet layout consumed by
// POST /api/it/users/import (lib/user-import.ts), plus a "Reference" sheet
// listing the valid Role Codes / Employee Type Codes / Store Nos / Area
// Names live from the DB — this codebase never sets Excel in-cell data
// validation (`!dataValidations`) anywhere, so a reference sheet + strict
// server-side verification on import is the established pattern instead.

import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import XlsxStyle from 'xlsx-js-style';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores, areas } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';
import { USER_IMPORT_COLUMNS } from '@/lib/user-import';

type Style = {
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
};

const THIN = { style: 'thin', color: { rgb: 'D1D5DB' } };
const border = () => ({ top: THIN, bottom: THIN, left: THIN, right: THIN });
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

const HEADER_STYLE: Style = { font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } }, fill: solid('334155'), alignment: CENTER, border: border() };
const TITLE_STYLE: Style = { font: { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FFFFFF' } }, fill: solid('0E7490'), alignment: LEFT, border: border() };
const INSTRUCTION_STYLE: Style = { font: { name: 'Arial', sz: 8.5, italic: true, color: { rgb: '64748B' } }, fill: solid('F0FDFA'), alignment: LEFT, border: border() };
const EXAMPLE_STYLE: Style = { font: { ...FONT_BASE, italic: true, color: { rgb: '94A3B8' } }, fill: solid('F8FAFC'), alignment: LEFT, border: border() };
const DATA_STYLE = (alt: boolean): Style => ({ font: { ...FONT_BASE, color: { rgb: '1E293B' } }, fill: solid(alt ? 'F8FAFC' : 'FFFFFF'), alignment: LEFT, border: border() });

const INSTRUCTIONS = [
  'Fill one row per user. Columns marked (required) must always be filled in. See the "Reference" sheet for valid codes/names.',
  'On UPDATE rows (NIK already exists): leave Role Code / Employee Type Code / Store No / Area Name blank to keep them unchanged.',
  'Type NONE in Store No or Area Name to clear an existing assignment. Password is optional on update (blank = keep current password).',
];

const COL_WIDTHS = [{ wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 9 }];

export async function GET(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const mode = req.nextUrl.searchParams.get('mode') === 'current' ? 'current' : 'template';

  const [roleRows, empTypeRows, storeRows, areaRows] = await Promise.all([
    db.select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
      .from(userRoles).where(eq(userRoles.isActive, true)).orderBy(asc(userRoles.sortOrder), asc(userRoles.id)),
    db.select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label })
      .from(employeeTypes).where(eq(employeeTypes.isActive, true)).orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.id)),
    db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId })
      .from(stores).orderBy(asc(stores.name)),
    db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(asc(areas.name)),
  ]);

  const areaNameById = new Map(areaRows.map((a) => [a.id, a.name]));

  const ws: XlsxStyle.WorkSheet = {};
  const merges: XlsxStyle.Range[] = [];
  const totalCols = USER_IMPORT_COLUMNS.length;

  // Title banner
  sc(ws, 0, 0, 'PRISM — Users Import Template', TITLE_STYLE);
  for (let c = 1; c < totalCols; c++) sc(ws, 0, c, '', TITLE_STYLE);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

  // Instructions
  let row = 1;
  for (const line of INSTRUCTIONS) {
    sc(ws, row, 0, line, INSTRUCTION_STYLE);
    for (let c = 1; c < totalCols; c++) sc(ws, row, c, '', INSTRUCTION_STYLE);
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: totalCols - 1 } });
    row++;
  }
  row++; // blank spacer

  // Header
  const headerRow = row;
  USER_IMPORT_COLUMNS.forEach((col, c) => sc(ws, headerRow, c, col.label, HEADER_STYLE));
  row++;

  if (mode === 'current') {
    const userRows = await db
      .select({
        nik: users.nik,
        name: users.name,
        roleCode: userRoles.code,
        employeeTypeCode: employeeTypes.code,
        storeNo: stores.storeNo,
        areaId: users.areaId,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
      .leftJoin(stores, eq(stores.id, users.homeStoreId))
      .orderBy(asc(users.name));

    userRows.forEach((u, idx) => {
      const r = row + idx;
      const style = DATA_STYLE(idx % 2 === 1);
      sc(ws, r, 0, u.nik, style);
      sc(ws, r, 1, u.name, style);
      sc(ws, r, 2, u.roleCode, style);
      sc(ws, r, 3, u.employeeTypeCode ?? '', style);
      sc(ws, r, 4, u.storeNo ?? '', style);
      sc(ws, r, 5, u.areaId != null ? (areaNameById.get(u.areaId) ?? '') : '', style);
      sc(ws, r, 6, '', style);
      sc(ws, r, 7, '', style);
    });
    row += userRows.length;
  } else {
    // One example row, values pulled live from the DB so it's always valid.
    const exampleRole = roleRows.find((r) => r.code === 'employee') ?? roleRows[0];
    const exampleEmpType = empTypeRows.find((t) => t.code === 'sa') ?? empTypeRows[0];
    const exampleStore = storeRows[0];
    const exampleAreaName = exampleStore ? (areaNameById.get(exampleStore.areaId) ?? '') : (areaRows[0]?.name ?? '');

    sc(ws, row, 0, 'EMP-0001', EXAMPLE_STYLE);
    sc(ws, row, 1, 'Contoh Nama Karyawan', EXAMPLE_STYLE);
    sc(ws, row, 2, exampleRole?.code ?? '', EXAMPLE_STYLE);
    sc(ws, row, 3, exampleEmpType?.code ?? '', EXAMPLE_STYLE);
    sc(ws, row, 4, exampleStore?.storeNo ?? '', EXAMPLE_STYLE);
    sc(ws, row, 5, exampleAreaName, EXAMPLE_STYLE);
    sc(ws, row, 6, '', EXAMPLE_STYLE);
    sc(ws, row, 7, 'TRUE', EXAMPLE_STYLE);
    row += 1;
  }

  ws['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(row, headerRow + 1) - 1, c: totalCols - 1 } });
  ws['!merges'] = merges;
  ws['!cols'] = COL_WIDTHS;
  ws['!freeze'] = { xSplit: 0, ySplit: headerRow + 1, topLeftCell: `A${headerRow + 2}` };

  // ─── Reference sheet ────────────────────────────────────────────────────────
  const ref: XlsxStyle.WorkSheet = {};
  const refMerges: XlsxStyle.Range[] = [];
  let rr = 0;

  function sectionTitle(title: string) {
    sc(ref, rr, 0, title, { font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } }, fill: solid('0E7490'), alignment: LEFT, border: border() });
    for (let c = 1; c < 3; c++) sc(ref, rr, c, '', { fill: solid('0E7490'), border: border() });
    refMerges.push({ s: { r: rr, c: 0 }, e: { r: rr, c: 2 } });
    rr++;
  }

  sectionTitle('Role Codes');
  roleRows.forEach((r) => { sc(ref, rr, 0, r.code, DATA_STYLE(false)); sc(ref, rr, 1, r.label, DATA_STYLE(false)); sc(ref, rr, 2, '', DATA_STYLE(false)); rr++; });
  rr++;

  sectionTitle('Employee Type Codes (with the role they belong to)');
  const EMP_TYPE_ROLE: Record<string, string> = { pic_1: 'employee', pic_2: 'employee', sa: 'employee', ops_ho: 'ops', ops_area: 'ops' };
  empTypeRows.forEach((t) => { sc(ref, rr, 0, t.code, DATA_STYLE(false)); sc(ref, rr, 1, t.label, DATA_STYLE(false)); sc(ref, rr, 2, EMP_TYPE_ROLE[t.code] ?? '', DATA_STYLE(false)); rr++; });
  rr++;

  sectionTitle('Store No (Store Name — Area)');
  storeRows.forEach((s) => { sc(ref, rr, 0, s.storeNo, DATA_STYLE(false)); sc(ref, rr, 1, s.name, DATA_STYLE(false)); sc(ref, rr, 2, areaNameById.get(s.areaId) ?? '', DATA_STYLE(false)); rr++; });
  rr++;

  sectionTitle('Area Names');
  areaRows.forEach((a) => { sc(ref, rr, 0, a.name, DATA_STYLE(false)); sc(ref, rr, 1, '', DATA_STYLE(false)); sc(ref, rr, 2, '', DATA_STYLE(false)); rr++; });

  ref['!ref'] = XlsxStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rr, 1) - 1, c: 2 } });
  ref['!merges'] = refMerges;
  ref['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }];

  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, ws, 'Users');
  XlsxStyle.utils.book_append_sheet(wb, ref, 'Reference');
  const buf = XlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

  const filename = mode === 'current' ? 'users_export.xlsx' : 'users_import_template.xlsx';

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
    },
  });
}
