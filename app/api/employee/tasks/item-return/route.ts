// app/api/employee/tasks/item-return/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  submitItemReturn,
  addReturnEntry,
  removeReturnEntry,
  autoSaveItemReturnById,
  type AutoSaveItemReturnPatch,
  type GeoPoint,
  type ReturnEntry,
} from '@/lib/db/utils/item-return';

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
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
  return undefined;
}

function readEntries(v: unknown): ReturnEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((e) => e && typeof e === 'object')
    .map((e: Record<string, unknown>) => ({
      returnNumber: String(e.returnNumber ?? ''),
      description: typeof e.description === 'string' ? e.description : null,
      expectedAt: typeof e.expectedAt === 'string' ? e.expectedAt : null,
      quantity: Math.max(0, Math.floor(Number(e.quantity ?? 0))),
      returnTime: String(e.returnTime ?? ''),
      returnPhotos: readStringArray(e.returnPhotos) ?? [],
      notes: typeof e.notes === 'string' ? e.notes : undefined,
    }));
}

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
    const storeId = toInt(body.storeId, 'storeId');
    const geo = readGeo(body);
    const skipGeo = Boolean(body.skipGeo);
    const userId = session.user.id as string;

    if (mode === 'add_entry') {
      const taskId = toInt(body.taskId, 'taskId');
      const returnNumber = typeof body.returnNumber === 'string' ? body.returnNumber : '';
      const description = typeof body.description === 'string' ? body.description : null;
      const expectedAt = typeof body.expectedAt === 'string' ? body.expectedAt : null;
      const quantity = Math.max(0, Math.floor(Number(body.quantity ?? 0)));
      const returnTime = typeof body.returnTime === 'string' ? body.returnTime : '';
      const returnPhotos = readStringArray(body.returnPhotos) ?? [];
      const notes = typeof body.notes === 'string' ? body.notes : undefined;

      const result = await addReturnEntry({
        taskId,
        scheduleId,
        userId,
        storeId,
        geo,
        skipGeo,
        returnNumber,
        description,
        expectedAt,
        quantity,
        returnTime,
        returnPhotos,
        notes,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    const hasReturn = Boolean(body.hasReturn);
    const entries = hasReturn ? readEntries(body.entries) : undefined;

    const result = await submitItemReturn({
      scheduleId,
      userId,
      storeId,
      geo,
      skipGeo,
      hasReturn,
      entries,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/item-return]', err);
    const isGeoErr = err instanceof Error && err.message.startsWith('Geolokasi');
    return NextResponse.json({ success: false, error: String(err) }, { status: isGeoErr ? 400 : 500 });
  }
}

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

  const patch: AutoSaveItemReturnPatch = {};
  if ('hasReturn' in body) patch.hasReturn = Boolean(body.hasReturn);
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveItemReturnById(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/item-return]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  try {
    const entryId = toInt(body.entryId, 'entryId');
    const scheduleId = toInt(body.scheduleId, 'scheduleId');
    const storeId = toInt(body.storeId, 'storeId');
    const geo = readGeo(body);
    const skipGeo = Boolean(body.skipGeo);
    const userId = session.user.id as string;

    const result = await removeReturnEntry({ entryId, scheduleId, userId, storeId, geo, skipGeo });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[DELETE /api/employee/tasks/item-return]', err);
    const isGeoErr = err instanceof Error && err.message.startsWith('Geolokasi');
    return NextResponse.json({ success: false, error: String(err) }, { status: isGeoErr ? 400 : 500 });
  }
}
