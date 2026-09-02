// app/api/employee/tasks/serah-terima/route.ts
//
// Serah Terima = a shared rolling handover board per store PLUS a per-shift,
// per-day completion task:
//   GET    — the board (active + recent history) + this shift's task status
//   POST   — { message } adds a board item; { action:'complete_task' } marks
//            this shift's serah terima task done (locks the board for today)
//   PATCH  — { entryId } completes one board item
//   DELETE — PIC-only: remove one history item
//
// Once this shift's task is completed for the day, add/complete/delete are
// rejected until the next day (a fresh task row).
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq, gte, lte } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { schedules } from '@/lib/db/schema';
import { todayInStoreTimezone } from '@/lib/schedule-utils';
import {
  listSerahTerimaEntries,
  createSerahTerimaEntry,
  completeSerahTerimaEntry,
  completeSerahTerimaTask,
  deleteSerahTerimaEntry,
  getOrCreateSerahTerimaTaskForShift,
  type GeoPoint,
} from '@/lib/db/utils/serah-terima';
import { resolveActorCodes } from '../../../pic/schedule/_utils';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function serializeEntry(entry: {
  id: number;
  storeId: number;
  message: string;
  createdByUserId: string;
  createdByShiftId: number;
  isCompleted: boolean;
  completedByUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: String(entry.id),
    storeId: String(entry.storeId),
    message: entry.message,
    createdByUserId: entry.createdByUserId,
    createdByShiftId: String(entry.createdByShiftId),
    isCompleted: entry.isCompleted,
    completedByUserId: entry.completedByUserId,
    completedAt: toIso(entry.completedAt),
    createdAt: toIso(entry.createdAt),
  };
}

async function findOwnScheduleForStore(userId: string, storeId: number) {
  const today = todayInStoreTimezone();

  const [row] = await db
    .select({ id: schedules.id, shiftId: schedules.shiftId })
    .from(schedules)
    .where(and(
      eq(schedules.userId, userId),
      eq(schedules.storeId, storeId),
      eq(schedules.isHoliday, false),
      gte(schedules.date, startOfDay(today)),
      lte(schedules.date, endOfDay(today)),
    ))
    .limit(1);

  return row ?? null;
}

function parseStoreId(searchParams: URLSearchParams | Record<string, unknown>): number | null {
  const raw = searchParams instanceof URLSearchParams
    ? searchParams.get('storeId')
    : (searchParams as Record<string, unknown>).storeId;

  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function boardPayload(
  storeId: number,
  ownSchedule: { id: number; shiftId: number },
  userId: string,
) {
  const [board, task] = await Promise.all([
    listSerahTerimaEntries(storeId),
    getOrCreateSerahTerimaTaskForShift(
      ownSchedule.id,
      userId,
      storeId,
      ownSchedule.shiftId,
      todayInStoreTimezone(),
    ),
  ]);

  return {
    success: true as const,
    storeId: String(storeId),
    scheduleId: String(ownSchedule.id),
    shiftId: String(ownSchedule.shiftId),
    task: {
      id: String(task.id),
      status: task.status,
      completedAt: toIso(task.completedAt),
      locked: task.status === 'completed',
    },
    entries: board.active.map(serializeEntry),
    recentCompleted: board.recentCompleted.map(serializeEntry),
  };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = parseStoreId(searchParams);
  if (!storeId) {
    return NextResponse.json({ success: false, error: 'storeId wajib diisi.' }, { status: 400 });
  }

  const ownSchedule = await findOwnScheduleForStore(session.user.id, storeId);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  return NextResponse.json(await boardPayload(storeId, ownSchedule, session.user.id));
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    storeId?: unknown;
    message?: unknown;
    notes?: unknown;
    geo?: GeoPoint;
    skipGeo?: boolean;
  };

  const storeId = Number(body.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'storeId wajib diisi.' }, { status: 400 });
  }
  if (!body.geo && !body.skipGeo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib diaktifkan.' },
      { status: 400 },
    );
  }

  const ownSchedule = await findOwnScheduleForStore(session.user.id, storeId);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  const isCompleteTask = body.action === 'complete_task';

  const result = isCompleteTask
    ? await completeSerahTerimaTask({
        storeId,
        scheduleId: ownSchedule.id,
        userId: session.user.id,
        shiftId: ownSchedule.shiftId,
        geo: body.geo ?? { lat: 0, lng: 0 },
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        skipGeo: body.skipGeo,
      })
    : await createSerahTerimaEntry({
        storeId,
        scheduleId: ownSchedule.id,
        userId: session.user.id,
        shiftId: ownSchedule.shiftId,
        geo: body.geo ?? { lat: 0, lng: 0 },
        message: typeof body.message === 'string' ? body.message : '',
        skipGeo: body.skipGeo,
      });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json(await boardPayload(storeId, ownSchedule, session.user.id));
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    storeId?: unknown;
    entryId?: unknown;
    geo?: GeoPoint;
    skipGeo?: boolean;
  };

  const storeId = Number(body.storeId);
  const entryId = Number(body.entryId);

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'storeId wajib diisi.' }, { status: 400 });
  }
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json({ success: false, error: 'entryId tidak valid.' }, { status: 400 });
  }
  if (!body.geo && !body.skipGeo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib diaktifkan.' },
      { status: 400 },
    );
  }

  const ownSchedule = await findOwnScheduleForStore(session.user.id, storeId);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  const result = await completeSerahTerimaEntry({
    entryId,
    storeId,
    scheduleId: ownSchedule.id,
    userId: session.user.id,
    shiftId: ownSchedule.shiftId,
    geo: body.geo ?? { lat: 0, lng: 0 },
    skipGeo: body.skipGeo,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json(await boardPayload(storeId, ownSchedule, session.user.id));
}

function isPicType(empType: string | null) {
  return empType === 'pic_1' || empType === 'pic_2';
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { role, empType } = await resolveActorCodes(session.user.id);
  if (role !== 'employee' || !isPicType(empType)) {
    return NextResponse.json({ success: false, error: 'Hanya PIC yang bisa menghapus riwayat.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = parseStoreId(searchParams);
  const entryId = Number(searchParams.get('entryId'));

  if (!storeId) {
    return NextResponse.json({ success: false, error: 'storeId wajib diisi.' }, { status: 400 });
  }
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json({ success: false, error: 'entryId tidak valid.' }, { status: 400 });
  }

  const ownSchedule = await findOwnScheduleForStore(session.user.id, storeId);
  if (!ownSchedule) {
    return NextResponse.json(
      { success: false, error: 'Tidak ada jadwal untuk toko ini hari ini.' },
      { status: 403 },
    );
  }

  const result = await deleteSerahTerimaEntry(entryId, storeId, ownSchedule.shiftId);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json(await boardPayload(storeId, ownSchedule, session.user.id));
}
