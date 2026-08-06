// app/api/employee/tasks/item-dropping/[id]/route.ts
//
// GET  — opens the Item Dropping task: live-syncs Business Central's Posted
//        Whse Shipments against this store (see syncItemDroppingForStore),
//        then returns the task + every entry (open and already-confirmed
//        today) with its linked transfer-order info for display.
// POST — confirms ONE transfer order's drop-off (qty counted + courier-signed
//        photo). Replaces the old whole-day batch submit.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { itemDroppingTasks, schedules, stores } from '@/lib/db/schema';
import {
  syncItemDroppingForStore,
  confirmItemDropping,
  getItemDroppingEntriesWithTransferOrder,
  type GeoPoint,
} from '@/lib/db/utils/item-transfers';

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

async function resolveId(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const p = await ctx.params;
  return Number(p.id);
}

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

function parseWhseShipmentLines(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const taskId = await resolveId(ctx);
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  const [task] = await db.select().from(itemDroppingTasks).where(eq(itemDroppingTasks.id, taskId)).limit(1);
  if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });

  const ownSchedule = await findOwnScheduleForTask(userId, task.storeId, task.date);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  const syncResult = await syncItemDroppingForStore(task.storeId, {
    scheduleId: ownSchedule.id,
    userId,
    date: task.date,
    shiftId: task.shiftId,
  });

  const [freshTask] = await db.select().from(itemDroppingTasks).where(eq(itemDroppingTasks.id, taskId)).limit(1);
  const rows = await getItemDroppingEntriesWithTransferOrder(taskId);

  const storeIds = [...new Set(
    rows.flatMap((r) => [r.transferOrder?.fromStoreId, r.transferOrder?.toStoreId])
      .filter((v): v is number => v != null),
  )];

  const storeRows = storeIds.length
    ? await db.select({ id: stores.id, name: stores.name, storeNo: stores.storeNo })
        .from(stores).where(inArray(stores.id, storeIds))
    : [];
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  const entries = rows.map(({ entry, transferOrder }) => ({
    id: String(entry.id),
    toaNo: entry.toNumber,
    qtyOrdered: entry.qtyOrdered ?? entry.quantity,
    qtyCounted: entry.qtyCounted,
    courierSignPhoto: entry.courierSignPhoto,
    submittedAt: entry.submittedAt?.toISOString() ?? null,
    fromStore: transferOrder?.fromStoreId ? storeById.get(transferOrder.fromStoreId) ?? null : null,
    toStore: transferOrder?.toStoreId ? storeById.get(transferOrder.toStoreId) ?? null : null,
    transferFromCode: transferOrder?.transferFromCode ?? null,
    transferToCode: transferOrder?.transferToCode ?? null,
    bcStatus: transferOrder?.bcStatus ?? null,
    whseShipmentNo: transferOrder?.whseShipmentNo ?? null,
    whseShipmentLines: parseWhseShipmentLines(transferOrder?.whseShipmentLines ?? null),
    // "In transit" timer starts the moment the linked Item Return leg was
    // confirmed — falls back to when we first saw this shipment if the
    // return leg was never synced separately.
    inTransitSince: (transferOrder?.returnSubmittedAt ?? transferOrder?.droppingDetectedAt ?? entry.createdAt)?.toISOString() ?? null,
  }));

  return NextResponse.json({
    success: true,
    scheduleId: ownSchedule.id,
    task: {
      id: String(freshTask.id),
      status: freshTask.status,
      hasDropping: freshTask.hasDropping,
      notes: freshTask.notes,
      completedAt: freshTask.completedAt?.toISOString() ?? null,
      verifiedBy: freshTask.verifiedBy,
      verifiedAt: freshTask.verifiedAt?.toISOString() ?? null,
      storeId: String(freshTask.storeId),
      date: freshTask.date.toISOString(),
    },
    entries,
    syncWarning: syncResult.success ? null : syncResult.error,
  });
}

interface ConfirmBody {
  entryId?: unknown;
  lat?: unknown;
  latitude?: unknown;
  lng?: unknown;
  longitude?: unknown;
  skipGeo?: unknown;
  qtyCounted?: unknown;
  courierSignPhoto?: unknown;
}

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const taskId = await resolveId(ctx);
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
  }

  const [task] = await db.select().from(itemDroppingTasks).where(eq(itemDroppingTasks.id, taskId)).limit(1);
  if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });

  let body: ConfirmBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

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

  const ownSchedule = await findOwnScheduleForTask(userId, task.storeId, task.date);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  const qtyCounted = Number(body.qtyCounted);
  const courierSignPhoto = typeof body.courierSignPhoto === 'string' ? body.courierSignPhoto : '';

  const result = await confirmItemDropping({
    entryId,
    scheduleId: ownSchedule.id,
    userId,
    storeId: task.storeId,
    geo,
    skipGeo,
    qtyCounted,
    courierSignPhoto,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
