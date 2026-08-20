// app/api/employee/item-transfers/confirm/route.ts
//
// Confirms ONE Item Dropping or Item Return entry (qty counted + courier
// -signed photo). `kind` picks which flow's tables/confirm function to use;
// everything else mirrors the old per-taskId confirm endpoints this replaces.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import { itemDroppingEntries, itemDroppingTasks, itemReturnEntries, itemReturnTasks, schedules } from '@/lib/db/schema';
import { confirmItemDropping, confirmItemReturn, type GeoPoint } from '@/lib/db/utils/item-transfers';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

async function findOwnScheduleForTask(userId: string, storeId: number, date: Date) {
  const [row] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(
      eq(schedules.userId, userId),
      eq(schedules.storeId, storeId),
      eq(schedules.isHoliday, false),
      gte(schedules.date, startOfDay(date)),
      lte(schedules.date, endOfDay(date)),
    ))
    .limit(1);
  return row ?? null;
}

interface ConfirmBody {
  kind?: unknown;
  entryId?: unknown;
  lat?: unknown;
  latitude?: unknown;
  lng?: unknown;
  longitude?: unknown;
  skipGeo?: unknown;
  qtyCounted?: unknown;
  courierSignPhoto?: unknown;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  let body: ConfirmBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const kind = body.kind === 'return' ? 'return' : body.kind === 'dropping' ? 'dropping' : null;
  if (!kind) {
    return NextResponse.json({ success: false, error: 'kind must be "dropping" or "return".' }, { status: 400 });
  }

  const entryId = Number(body.entryId);
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ success: false, error: 'entryId wajib diisi.' }, { status: 400 });
  }

  const lat = Number(body.lat ?? body.latitude);
  const lng = Number(body.lng ?? body.longitude);
  const skipGeo = Boolean(body.skipGeo);
  if (!skipGeo && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    return NextResponse.json(
      { success: false, error: 'Geolokasi tidak valid. Aktifkan GPS dan coba lagi.' },
      { status: 400 },
    );
  }
  const geo: GeoPoint = { lat: Number.isFinite(lat) ? lat : 0, lng: Number.isFinite(lng) ? lng : 0 };

  const qtyCounted = Number(body.qtyCounted);
  const courierSignPhoto = typeof body.courierSignPhoto === 'string' ? body.courierSignPhoto : '';

  if (kind === 'dropping') {
    const [entry] = await db.select().from(itemDroppingEntries).where(eq(itemDroppingEntries.id, entryId)).limit(1);
    if (!entry) return NextResponse.json({ success: false, error: 'Entry not found' }, { status: 404 });

    const [task] = await db.select().from(itemDroppingTasks).where(eq(itemDroppingTasks.id, entry.taskId)).limit(1);
    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });

    const ownSchedule = await findOwnScheduleForTask(userId, task.storeId, task.date);
    if (!ownSchedule) {
      return NextResponse.json({ success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' }, { status: 403 });
    }

    const result = await confirmItemDropping({
      entryId, scheduleId: ownSchedule.id, userId, storeId: task.storeId, geo, skipGeo, qtyCounted, courierSignPhoto,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  const [entry] = await db.select().from(itemReturnEntries).where(eq(itemReturnEntries.id, entryId)).limit(1);
  if (!entry) return NextResponse.json({ success: false, error: 'Entry not found' }, { status: 404 });

  const [task] = await db.select().from(itemReturnTasks).where(eq(itemReturnTasks.id, entry.taskId)).limit(1);
  if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });

  const ownSchedule = await findOwnScheduleForTask(userId, task.storeId, task.date);
  if (!ownSchedule) {
    return NextResponse.json({ success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' }, { status: 403 });
  }

  const result = await confirmItemReturn({
    entryId, scheduleId: ownSchedule.id, userId, storeId: task.storeId, geo, skipGeo, qtyCounted, courierSignPhoto,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
