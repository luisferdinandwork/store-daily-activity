// app/api/employee/tasks/cek-uang-modal/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  submitCekUangModal,
  autoSaveCekUangModalById,
  CEK_UANG_MODAL_DENOMINATIONS,
  CEK_UANG_MODAL_MAX_TOTAL,
  type AutoSaveCekUangModalPatch,
  type GeoPoint,
  type UangModalDenominationInput,
} from '@/lib/db/utils/cek-uang-modal';

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

function readDenominations(v: unknown): UangModalDenominationInput[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item) => item && typeof item === 'object')
    .map((item: Record<string, unknown>) => ({
      denominationValue: Number(item.denominationValue),
      quantity: Math.max(0, Math.floor(Number(item.quantity ?? 0))),
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    }));
}

export async function GET() {
  // Small helper for the frontend form so it can render the correct pecahan list.
  return NextResponse.json({
    success: true,
    denominations: CEK_UANG_MODAL_DENOMINATIONS,
    maxTotalAmount: CEK_UANG_MODAL_MAX_TOTAL,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  try {
    const scheduleId = toInt(body.scheduleId, 'scheduleId');
    const storeId = toInt(body.storeId, 'storeId');
    const geo = readGeo(body);
    const skipGeo = Boolean(body.skipGeo);
    const userId = session.user.id as string;
    const denominations = readDenominations(body.denominations);
    const taskId = body.taskId != null ? toInt(body.taskId, 'taskId') : undefined;

    const result = await submitCekUangModal({
      taskId,
      scheduleId,
      userId,
      storeId,
      geo,
      skipGeo,
      denominations,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/cek-uang-modal]', err);
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

  const patch: AutoSaveCekUangModalPatch = {};
  if ('denominations' in body) patch.denominations = readDenominations(body.denominations);
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveCekUangModalById(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/cek-uang-modal]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
