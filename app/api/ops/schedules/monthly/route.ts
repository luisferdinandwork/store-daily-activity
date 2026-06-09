// app/api/ops/schedules/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import {
  createEmptyMonthlySchedule,
  deleteMonthlySchedule,
  getMonthlySchedule,
} from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
  parseStoreId,
} from '../_helpers';

function mapSchedule(rawSchedule: Awaited<ReturnType<typeof getMonthlySchedule>>) {
  if (!rawSchedule) return null;

  return {
    ...rawSchedule.schedule,
    id: String(rawSchedule.schedule.id),
    storeId: String(rawSchedule.schedule.storeId),
    entries: rawSchedule.entries.map((entry: any) => ({
      id: String(entry.id),
      userId: entry.userId,
      userName: entry.userName,
      userType: entry.userEmployeeType,
      date: entry.date,
      shiftId: entry.shiftId,
      shift: entry.shiftCode ?? null,
      shiftCode: entry.shiftCode ?? null,
      shiftLabel: entry.shiftLabel ?? entry.shiftCode ?? null,
      isOff: entry.isOff,
      isLeave: entry.isLeave,
    })),
  };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const parsedStore = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  if (!parsedStore.ok) {
    return NextResponse.json(
      { success: false, error: parsedStore.error },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const areaError = await assertStoreInActorArea(actor, parsedStore.id);

  if (areaError) {
    return NextResponse.json(
      { success: false, error: areaError },
      { status: 403 },
    );
  }

  const rawSchedule = await getMonthlySchedule(parsedStore.id, yearMonth);

  return NextResponse.json({
    success: true,
    schedule: mapSchedule(rawSchedule),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsedStore = parseStoreId(body.storeId);
  const yearMonth = typeof body.yearMonth === 'string' ? body.yearMonth : null;
  const note = typeof body.note === 'string' ? body.note : undefined;

  if (!parsedStore.ok) {
    return NextResponse.json(
      { success: false, error: parsedStore.error },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const areaError = await assertStoreInActorArea(actor, parsedStore.id);

  if (areaError) {
    return NextResponse.json(
      { success: false, error: areaError },
      { status: 403 },
    );
  }

  const result = await createEmptyMonthlySchedule(
    parsedStore.id,
    yearMonth,
    actor.id,
    note,
  );

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const parsedStore = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  if (!parsedStore.ok) {
    return NextResponse.json(
      { success: false, error: parsedStore.error },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const areaError = await assertStoreInActorArea(actor, parsedStore.id);

  if (areaError) {
    return NextResponse.json(
      { success: false, error: areaError },
      { status: 403 },
    );
  }

  const result = await deleteMonthlySchedule(parsedStore.id, yearMonth, actor.id);

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
