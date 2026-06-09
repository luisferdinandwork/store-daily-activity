// app/api/ops/schedules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { materialiseSchedulesForMonth } from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
  parseStoreId,
} from './_helpers';

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

  try {
    const result = await materialiseSchedulesForMonth(parsedStore.id, yearMonth);

    return NextResponse.json({
      success: result.errors.length === 0,
      schedulesCreated: result.schedulesCreated,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[POST /api/ops/schedules]', err);

    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}