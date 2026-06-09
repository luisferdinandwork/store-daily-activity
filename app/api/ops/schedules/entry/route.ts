// app/api/ops/schedules/entry/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import {
  createMonthlyScheduleEntry,
  dateToYearMonth,
} from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
  normalizeShiftCode,
  parseLocalDate,
  parseStoreId,
} from '../_helpers';

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

  if (!parsedStore.ok) {
    return NextResponse.json(
      { success: false, error: parsedStore.error },
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

  const userId = typeof body.userId === 'string' ? body.userId : null;
  const dateValue = typeof body.date === 'string' ? body.date : null;
  const shift = normalizeShiftCode(body.shift);

  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'userId required.' },
      { status: 400 },
    );
  }

  if (!dateValue) {
    return NextResponse.json(
      { success: false, error: 'date required.' },
      { status: 400 },
    );
  }

  const date = parseLocalDate(dateValue);

  if (!date) {
    return NextResponse.json(
      { success: false, error: 'Invalid date.' },
      { status: 400 },
    );
  }

  const result = await createMonthlyScheduleEntry(
    parsedStore.id,
    dateToYearMonth(date),
    userId,
    date,
    {
      shift,
      isOff: !!body.isOff,
      isLeave: !!body.isLeave,
    },
    actor.id,
  );

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
