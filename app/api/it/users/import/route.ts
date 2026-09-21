// app/api/it/users/import/route.ts
//
// POST /api/it/users/import
//   FormData: file (required, .xlsx/.xls), commit ('true' to actually write),
//             sheet (optional — which sheet to import; defaults to "Users",
//             else the first sheet with a NIK/Employee No. + Name header)
//
// Two-step "great verification" flow the Users page drives:
//   1. Called with no `commit` (or commit=false) → parses + validates only,
//      returns a full per-row report so the admin can review it.
//   2. Called again with commit=true (same file re-uploaded) → writes only
//      the rows that passed validation; other rows are skipped, never
//      aborting the whole batch. Areas/stores the rows refer to that don't
//      exist yet are created with them (see lib/user-import.ts).

import { NextRequest, NextResponse } from 'next/server';
import { resolveItScope } from '@/lib/auth/it-scope';
import { parseUsersWorkbook, loadUserImportLookups, buildUserImportReport } from '@/lib/user-import';

export async function POST(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const commit = formData.get('commit') === 'true';
  const sheetField = formData.get('sheet');
  const requestedSheet = typeof sheetField === 'string' && sheetField.trim() ? sheetField : undefined;

  if (!file) {
    return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  let parsed;
  try {
    parsed = parseUsersWorkbook(buffer, requestedSheet);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Could not read this file as an Excel workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if ('headerError' in parsed) {
    return NextResponse.json({ success: false, error: parsed.headerError }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json({ success: false, error: 'No data rows found below the header row.' }, { status: 400 });
  }

  const lookups = await loadUserImportLookups();
  const report = await buildUserImportReport(parsed.rows, lookups, { commit, assignedBy: scope.userId });

  return NextResponse.json({ success: true, commit, sheetName: parsed.sheetName, sheets: parsed.sheets, report });
}
