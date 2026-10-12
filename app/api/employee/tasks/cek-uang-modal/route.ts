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
  resolveCekUangModalActor,
  getCekUangModalBySchedule,
} from '@/lib/db/utils/cek-uang-modal';
import { parseGeoPoint } from '@/lib/geo';
import { taskRequiresLocation } from '@/lib/db/utils/task-location';
import { db } from '@/lib/db';
import { schedules } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

function toInt(val: unknown, field: string): number {
  const n = typeof val === 'number' || typeof val === 'string' ? Number(val) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${field} tidak valid. Buka ulang daftar task.`);
  return n;
}

function readGeo(body: Record<string, unknown>): GeoPoint | null {
  return parseGeoPoint(body.lat ?? body.latitude, body.lng ?? body.longitude, body.accuracy);
}

async function resolveActorFromBody(body: Record<string, unknown>, userId: string) {
  let taskId: number;
  if (body.taskId != null) {
    taskId = toInt(body.taskId, 'taskId');
  } else {
    const scheduleId = toInt(body.scheduleId, 'scheduleId');
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
    if (!schedule || schedule.userId !== userId) return { success: false as const, error: 'Jadwal bukan milik kamu.', status: 403 };
    const task = await getCekUangModalBySchedule(scheduleId);
    if (!task) return { success: false as const, error: 'Task tidak ditemukan. Buka ulang daftar task.', status: 404 };
    taskId = task.id;
  }
  return resolveCekUangModalActor(taskId, userId);
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
    const userId = session.user.id as string;
    const actor = await resolveActorFromBody(body, userId);
    if (!actor.success) return NextResponse.json(actor, { status: actor.status });
    const { scheduleId, task } = actor.data;
    const storeId = task.storeId;
    const skipGeo = !(await taskRequiresLocation('cek_uang_modal'));
    const point = readGeo(body);
    if (!skipGeo && !point) return NextResponse.json({ success: false, error: 'Lokasi wajib aktif. Perbarui lokasi lalu coba lagi.' }, { status: 400 });
    const geo = point ?? { lat: 0, lng: 0 };
    const denominations = readDenominations(body.denominations);
    const taskId = task.id;

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
    const isInputError = err instanceof Error && err.message.includes('tidak valid.');
    return NextResponse.json({ success: false, error: isInputError ? (err as Error).message : 'Gagal memvalidasi task. Silakan coba lagi.' }, { status: isInputError ? 400 : 500 });
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
    const actor = await resolveCekUangModalActor(taskId, session.user.id);
    if (!actor.success) return NextResponse.json(actor, { status: actor.status });
    const result = await autoSaveCekUangModalById(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/cek-uang-modal]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
