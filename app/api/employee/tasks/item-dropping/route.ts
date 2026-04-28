import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitItemDropping,
  addToEntry,
  removeToEntry,
  autoSaveItemDroppingById,
  type AutoSaveItemDroppingPatch,
  type GeoPoint,
  type ToEntry,
} from '@/lib/db/utils/item-dropping';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function readGeo(body: Record<string, unknown>): GeoPoint {
  const lat = Number(body.lat ?? body.latitude);
  const lng = Number(body.lng ?? body.longitude);
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error('Geolokasi tidak valid. Aktifkan GPS dan coba lagi.');
  }
  return { lat, lng };
}

function readStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string') as string[];
  return undefined;
}

function readEntries(v: unknown): ToEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(e => e && typeof e === 'object')
    .map((e: Record<string, unknown>) => ({
      toNumber:       String(e.toNumber ?? ''),
      dropTime:       String(e.dropTime ?? ''),
      droppingPhotos: readStringArray(e.droppingPhotos) ?? [],
      notes:          typeof e.notes === 'string' ? e.notes : undefined,
    }));
}

// ─── POST ─────────────────────────────────────────────────────────────────────
//
// Two modes:
//   • mode = 'submit'     → submit the task header (hasDropping flag + optional
//                           full entries array for first-time batch submit)
//   • mode = 'add_entry'  → add a single TO entry to an existing task
//                           requires: taskId, toNumber, dropTime, droppingPhotos
//
// If mode is omitted, 'submit' is assumed.

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const mode = typeof body.mode === 'string' ? body.mode : 'submit';

  try {
    const scheduleId = toInt(body.scheduleId, 'scheduleId');
    const storeId    = toInt(body.storeId,    'storeId');
    const geo        = readGeo(body);
    const skipGeo    = Boolean(body.skipGeo);
    const userId     = session.user.id as string;

    // ── Add single TO entry to an existing task ─────────────────────────────
    if (mode === 'add_entry') {
      const taskId        = toInt(body.taskId, 'taskId');
      const toNumber      = typeof body.toNumber === 'string' ? body.toNumber : '';
      const dropTime      = typeof body.dropTime === 'string' ? body.dropTime : '';
      const droppingPhotos = readStringArray(body.droppingPhotos) ?? [];
      const notes         = typeof body.notes === 'string' ? body.notes : undefined;

      const result = await addToEntry({
        taskId,
        scheduleId,
        userId,
        storeId,
        geo,
        skipGeo,
        toNumber,
        dropTime,
        droppingPhotos,
        notes,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── Submit mode ─────────────────────────────────────────────────────────
    const hasDropping = Boolean(body.hasDropping);
    const entries     = hasDropping ? readEntries(body.entries) : undefined;

    const result = await submitItemDropping({
      scheduleId,
      userId,
      storeId,
      geo,
      skipGeo,
      hasDropping,
      entries,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/item-dropping]', err);
    const isGeoErr = err instanceof Error && err.message.startsWith('Geolokasi');
    return NextResponse.json({ success: false, error: String(err) }, { status: isGeoErr ? 400 : 500 });
  }
}

// ─── PATCH (auto-save) ────────────────────────────────────────────────────────
//
// Keyed by taskId. Only patches the task header fields (hasDropping, notes).
// Individual TO entries are managed via POST mode=add_entry and DELETE.

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let taskId: number;
  try { taskId = toInt(body.taskId, 'taskId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveItemDroppingPatch = {};
  if ('hasDropping' in body) patch.hasDropping = Boolean(body.hasDropping);
  if ('notes'       in body) patch.notes       = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveItemDroppingById(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/item-dropping]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── DELETE (remove a single TO entry) ───────────────────────────────────────
//
// Body: { entryId, scheduleId, storeId, lat, lng, skipGeo? }

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  try {
    const entryId    = toInt(body.entryId,    'entryId');
    const scheduleId = toInt(body.scheduleId, 'scheduleId');
    const storeId    = toInt(body.storeId,    'storeId');
    const geo        = readGeo(body);
    const skipGeo    = Boolean(body.skipGeo);
    const userId     = session.user.id as string;

    const result = await removeToEntry({
      entryId,
      scheduleId,
      userId,
      storeId,
      geo,
      skipGeo,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[DELETE /api/employee/tasks/item-dropping]', err);
    const isGeoErr = err instanceof Error && err.message.startsWith('Geolokasi');
    return NextResponse.json({ success: false, error: String(err) }, { status: isGeoErr ? 400 : 500 });
  }
}