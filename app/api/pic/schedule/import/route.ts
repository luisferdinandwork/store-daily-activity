// app/api/pic/schedule/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  parseScheduleBuffer,
  importScheduleFromParsed,
} from '@/lib/schedule-import';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user         = session.user as any;
  const actorId      = user.id           as string;
  const role         = user.role         as string;
  const employeeType = user.employeeType as string | null;
  const actorStoreId = user.homeStoreId  as string | null;

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json(
      { success: false, error: 'Only OPS or PIC 1 can import schedules.' },
      { status: 403 },
    );
  }

  try {
    const formData = await req.formData();
    const file     = formData.get('file')     as File   | null;
    const sheet    = formData.get('sheet')    as string | undefined;
    const rawMap   = formData.get('storeMap') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    }

    // storeMap: { [sectionLabelInExcel]: storeId }
    let storeMap: Record<string, string> = {};
    if (rawMap) {
      try { storeMap = JSON.parse(rawMap); }
      catch { return NextResponse.json({ success: false, error: 'Invalid storeMap JSON.' }, { status: 400 }); }
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseScheduleBuffer(buffer, sheet);

    console.log('[import] sections in file:', parsed.sections);
    console.log('[import] employees found:',  parsed.employees.length);
    console.log('[import] actorStoreId:',     actorStoreId);
    console.log('[import] explicit storeMap:', storeMap);

    if (!actorStoreId && Object.keys(storeMap).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No storeMap provided and actor has no home store.' },
        { status: 400 },
      );
    }

    // Build normalized map:
    //   1. Explicit match from storeMap  (OPS multi-store)
    //   2. Fall back to actorStoreId     (PIC 1 single-store — ALL sections → their store)
    const normalized: Record<string, string> = {};
    for (const section of parsed.sections) {
      if (storeMap[section]) {
        normalized[section] = storeMap[section];
      } else if (actorStoreId) {
        normalized[section] = actorStoreId;
      }
    }

    console.log('[import] normalized storeMap:', normalized);

    const result = await importScheduleFromParsed(parsed, normalized, actorId);
    console.log('[import] result:', JSON.stringify(result));

    return NextResponse.json({
      success:          result.errors.length === 0,
      schedulesCreated: result.schedulesCreated,
      entriesCreated:   result.entriesCreated,
      skipped:          result.skipped,
      errors:           result.errors,
      notFound:         result.notFound,
      month:            result.month,
      sheet:            result.sheet,
      sections:         parsed.sections,
    });
  } catch (err) {
    console.error('[schedule/import] uncaught error:', err);
    return NextResponse.json(
      { success: false, error: `Import failed: ${err}` },
      { status: 500 },
    );
  }
}