// app/api/employee/tasks/open-statement/route.ts
// ─────────────────────────────────────────────────────────────────────────────
//   POST  → final submit (compare expected vs actual, discrepancy bookkeeping)
//   PATCH → auto-save partial patch
//   PUT   → fetch-expected (idempotent)  body: { taskId }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitOpenStatement, autoSaveOpenStatement, fetchExpectedForTask,
  type AutoSaveOpenStatementPatch,
} from '@/lib/db/utils/open-statement';

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

// ─── POST (final submit) ──────────────────────────────────────────────────────

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
    const result = await submitOpenStatement({
      scheduleId,
      userId:       session.user.id as string,
      storeId,
      geo,
      skipGeo:      effectiveSkipGeo,
      actualAmount: typeof body.actualAmount === 'string' ? body.actualAmount : String(body.actualAmount ?? ''),
      notes:        typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/open-statement]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH (auto-save) ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  try { scheduleId = toInt(body.scheduleId, 'scheduleId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveOpenStatementPatch = {};
  if ('actualAmount' in body) patch.actualAmount = typeof body.actualAmount === 'string' ? body.actualAmount : String(body.actualAmount ?? '');
  if ('notes'        in body) patch.notes        = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveOpenStatement(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/open-statement]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PUT (fetch expected) ─────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const taskId = parseInt(String(body.taskId ?? ''), 10);
  if (isNaN(taskId))
    return NextResponse.json({ success: false, error: 'taskId must be a valid integer' }, { status: 400 });

  try {
    const result = await fetchExpectedForTask(taskId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PUT /api/employee/tasks/open-statement]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}