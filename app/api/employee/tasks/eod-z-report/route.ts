// app/api/employee/tasks/eod-z-report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitEodZReport, autoSaveEodZReport,
  type AutoSaveEodZReportPatch,
} from '@/lib/db/utils/eod-z-report';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  let storeId:    number;
  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId    = toInt(body.storeId,    'storeId');
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const skipGeo          = body.skipGeo === true;
  const rawGeo           = toGeo(body.geo, skipGeo);
  const geo              = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  try {
    const result = await submitEodZReport({
      scheduleId,
      userId:        session.user.id as string,
      storeId,
      geo,
      skipGeo:       effectiveSkipGeo,
      totalNominal:  typeof body.totalNominal === 'string' ? body.totalNominal : String(body.totalNominal ?? ''),
      zReportPhotos: strArr(body.zReportPhotos),
      notes:         typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/eod-z-report]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH (auto-save) ───────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  try { scheduleId = toInt(body.scheduleId, 'scheduleId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveEodZReportPatch = {};
  if ('totalNominal'  in body) patch.totalNominal  = typeof body.totalNominal === 'string' ? body.totalNominal : String(body.totalNominal ?? '');
  if ('notes'         in body) patch.notes         = typeof body.notes === 'string' ? body.notes : undefined;
  if ('zReportPhotos' in body) patch.zReportPhotos = strArr(body.zReportPhotos);

  try {
    const result = await autoSaveEodZReport(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/eod-z-report]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}