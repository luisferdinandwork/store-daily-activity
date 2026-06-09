// app/api/pic/schedule/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import {
  getMonthlySchedule,
  deleteMonthlySchedule,
  createEmptyMonthlySchedule,
} from '@/lib/schedule-utils';

import {
  canManageSchedule,
  resolveActorCodes,
} from '../_utils';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const user = session.user as any;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  if (!rawHomeStoreId) {
    return NextResponse.json(
      { success: false, error: 'No home store.' },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const storeId = Number(rawHomeStoreId);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid homeStoreId.' },
      { status: 400 },
    );
  }

  const rawSchedule = await getMonthlySchedule(storeId, yearMonth);

  if (!rawSchedule) {
    return NextResponse.json({
      success: true,
      schedule: null,
    });
  }

  const mappedEntries = rawSchedule.entries.map((entry: any) => ({
    id: String(entry.id),
    userId: entry.userId,
    userName: entry.userName,
    userType: entry.userEmployeeType,
    date: entry.date,

    shiftId: entry.shiftId,

    // Dynamic shift support
    shift: entry.shiftCode ?? null,
    shiftCode: entry.shiftCode ?? null,
    shiftLabel: entry.shiftLabel ?? entry.shiftCode ?? null,

    isOff: entry.isOff,
    isLeave: entry.isLeave,
  }));

  const schedule = {
    ...rawSchedule.schedule,
    id: String(rawSchedule.schedule.id),
    storeId: String(rawSchedule.schedule.storeId),
    entries: mappedEntries,
  };

  return NextResponse.json({
    success: true,
    schedule,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const user = session.user as any;
  const actorId = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;

  const { role, empType } = await resolveActorCodes(actorId);

  if (!canManageSchedule(role, empType)) {
    return NextResponse.json(
      { success: false, error: 'Only OPS or PIC 1 can create schedules.' },
      { status: 403 },
    );
  }

  if (!rawHomeStoreId) {
    return NextResponse.json(
      { success: false, error: 'No home store.' },
      { status: 400 },
    );
  }

  const storeId = Number(rawHomeStoreId);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid homeStoreId.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const yearMonth = body.yearMonth as string | undefined;
  const note = body.note as string | undefined;

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const result = await createEmptyMonthlySchedule(
    storeId,
    yearMonth,
    actorId,
    note,
  );

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const user = session.user as any;
  const actorId = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  const { role, empType } = await resolveActorCodes(actorId);

  if (!canManageSchedule(role, empType)) {
    return NextResponse.json(
      { success: false, error: 'Only OPS or PIC 1 can delete schedules.' },
      { status: 403 },
    );
  }

  if (!rawHomeStoreId) {
    return NextResponse.json(
      { success: false, error: 'No home store.' },
      { status: 400 },
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { success: false, error: 'yearMonth required.' },
      { status: 400 },
    );
  }

  const storeId = Number(rawHomeStoreId);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid homeStoreId.' },
      { status: 400 },
    );
  }

  const result = await deleteMonthlySchedule(storeId, yearMonth, actorId);

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}