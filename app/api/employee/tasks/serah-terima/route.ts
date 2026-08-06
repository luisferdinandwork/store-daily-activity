// app/api/employee/tasks/serah-terima/route.ts
//
// Serah Terima is now a shared, rolling handover board per store (see
// lib/db/utils/serah-terima.ts) — not a per-shift, per-day task row. This
// route is store-scoped rather than id-scoped: GET returns the active board
// for a store, POST adds a new entry, PATCH completes one.
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
  type GeoPoint,
} from '@/lib/db/utils/serah-terima';

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

  const board = await listSerahTerimaEntries(storeId);

  return NextResponse.json({
    success: true,
    storeId: String(storeId),
    scheduleId: String(ownSchedule.id),
    shiftId: String(ownSchedule.shiftId),
    entries: board.active.map(serializeEntry),
    recentCompleted: board.recentCompleted.map(serializeEntry),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    storeId?: unknown;
    message?: unknown;
    geo?: GeoPoint;
    skipGeo?: boolean;
  };

  const storeId = Number(body.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'storeId wajib diisi.' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message : '';
  if (!body.geo && !body.skipGeo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib diaktifkan sebelum menambah item serah terima.' },
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

  const result = await createSerahTerimaEntry({
    storeId,
    scheduleId: ownSchedule.id,
    userId: session.user.id,
    shiftId: ownSchedule.shiftId,
    geo: body.geo ?? { lat: 0, lng: 0 },
    message,
    skipGeo: body.skipGeo,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  const board = await listSerahTerimaEntries(storeId);

  return NextResponse.json({
    success: true,
    entries: board.active.map(serializeEntry),
    recentCompleted: board.recentCompleted.map(serializeEntry),
  });
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
      { success: false, error: 'Lokasi wajib diaktifkan sebelum menyelesaikan item serah terima.' },
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

  const board = await listSerahTerimaEntries(storeId);

  return NextResponse.json({
    success: true,
    entries: board.active.map(serializeEntry),
    recentCompleted: board.recentCompleted.map(serializeEntry),
  });
}
