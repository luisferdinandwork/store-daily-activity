// app/api/employee/tasks/item-dropping/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated endpoint for the Item Dropping task.
//   POST  → final submit (check-in + geofence + payload validation)
//   PATCH → auto-save partial patch (status: pending → in_progress)
//   PUT   → confirm receipt of a carry-forward (discrepancy) task
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitItemDropping,
  autoSaveItemDropping,
  confirmItemReceipt,
  type AutoSaveItemDroppingPatch,
} from '@/lib/db/utils/item-dropping';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function toDateOrUndefined(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── POST (final submit) ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

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

  const hasDropping  = Boolean(body.hasDropping);
  const isReceived   = Boolean(body.isReceived);
  const parentTaskId = body.parentTaskId ? Number(body.parentTaskId) : undefined;

  try {
    const result = await submitItemDropping({
      scheduleId,
      userId:           session.user.id as string,
      storeId,
      geo,
      skipGeo:          effectiveSkipGeo,
      hasDropping,
      dropTime:         toDateOrUndefined(body.dropTime),
      droppingPhotos:   strArr(body.droppingPhotos),
      isReceived,
      receiveTime:      toDateOrUndefined(body.receiveTime),
      receivedByUserId: typeof body.receivedByUserId === 'string' ? body.receivedByUserId : undefined,
      notes:            typeof body.notes === 'string' ? body.notes : undefined,
      parentTaskId,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/item-dropping]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH (auto-save) ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  try { scheduleId = toInt(body.scheduleId, 'scheduleId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveItemDroppingPatch = {};

  if ('hasDropping'      in body) patch.hasDropping      = Boolean(body.hasDropping);
  if ('dropTime'         in body) patch.dropTime         = typeof body.dropTime === 'string' ? body.dropTime : null;
  if ('droppingPhotos'   in body) patch.droppingPhotos   = strArr(body.droppingPhotos);
  if ('isReceived'       in body) patch.isReceived       = Boolean(body.isReceived);
  if ('receiveTime'      in body) patch.receiveTime      = typeof body.receiveTime === 'string' ? body.receiveTime : null;
  if ('receivedByUserId' in body) patch.receivedByUserId = typeof body.receivedByUserId === 'string' ? body.receivedByUserId : null;
  if ('notes'            in body) patch.notes            = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveItemDropping(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/item-dropping]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PUT (confirm receipt of carry-forward task) ─────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let taskId:     number;
  let scheduleId: number;
  let storeId:    number;
  try {
    taskId     = toInt(body.taskId,     'taskId');
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
    const result = await confirmItemReceipt({
      taskId,
      scheduleId,
      userId:           session.user.id as string,
      storeId,
      geo,
      skipGeo:          effectiveSkipGeo,
      receiveTime:      toDateOrUndefined(body.receiveTime),
      receivedByUserId: typeof body.receivedByUserId === 'string' ? body.receivedByUserId : undefined,
      notes:            typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PUT /api/employee/tasks/item-dropping]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}