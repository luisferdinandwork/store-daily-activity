// app/api/ops/schedules/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  parseScheduleBuffer,
  importScheduleFromParsed,
  ScheduleImportValidationError,
} from '@/lib/schedule-import';
import { getOpsActor, assertStoreInActorArea, parseStoreId } from '../_helpers';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  try {
    const formData = await req.formData();
    const file     = formData.get('file')     as File   | null;
    const sheet    = formData.get('sheet')    as string | undefined;
    const storeIdRaw = formData.get('storeId') as string | null;
    const rawMap   = formData.get('storeMap') as string | null;

    if (!file) return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });

    const parsedStore = parseStoreId(storeIdRaw);
    if (!parsedStore.ok) return NextResponse.json({ success: false, error: parsedStore.error }, { status: 400 });

    const areaErr = await assertStoreInActorArea(actor, parsedStore.id);
    if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

    let storeMap: Record<string, number> = {};
    if (rawMap) {
      try {
        const parsed = JSON.parse(rawMap) as Record<string, string | number>;
        for (const [k, v] of Object.entries(parsed)) {
          const n = Number(v);
          if (!isNaN(n)) {
            // Each mapped store must also be in the actor's area
            const mapAreaErr = await assertStoreInActorArea(actor, n);
            if (mapAreaErr) {
              return NextResponse.json(
                { success: false, error: `storeMap target "${k}" → ${n}: ${mapAreaErr}` },
                { status: 403 },
              );
            }
            storeMap[k] = n;
          }
        }
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid storeMap JSON.' }, { status: 400 });
      }
    }

    const buffer = await file.arrayBuffer();

    let parsed;
    try {
      parsed = parseScheduleBuffer(buffer, sheet);
    } catch (err) {
      if (err instanceof ScheduleImportValidationError) {
        return NextResponse.json(
          {
            success:    false,
            error:      'The Excel file has incorrect dates. Please fix and re-upload.',
            dateErrors: err.dateErrors,
          },
          { status: 400 },
        );
      }
      throw err;
    }

    // Default every section to the chosen storeId unless overridden by storeMap
    const normalized: Record<string, number> = {};
    for (const section of parsed.sections) {
      normalized[section] = storeMap[section] ?? parsedStore.id;
    }

    const result = await importScheduleFromParsed(parsed, normalized, actor.id);

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
    console.error('[ops schedules/import] uncaught error:', err);
    return NextResponse.json({ success: false, error: `Import failed: ${err}` }, { status: 500 });
  }
}