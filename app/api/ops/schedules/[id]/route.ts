// app/api/ops/schedules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { monthlySchedules } from '@/lib/db/schema';
import { deleteMonthlySchedule } from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
} from '../_helpers';

async function resolveId(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const params = await ctx.params;
  return Number(params.id);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
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

  const scheduleId = await resolveId(ctx);

  if (!Number.isInteger(scheduleId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid schedule id.' },
      { status: 400 },
    );
  }

  try {
    const [schedule] = await db
      .select({
        storeId: monthlySchedules.storeId,
        yearMonth: monthlySchedules.yearMonth,
      })
      .from(monthlySchedules)
      .where(eq(monthlySchedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found.' },
        { status: 404 },
      );
    }

    const areaError = await assertStoreInActorArea(actor, schedule.storeId);

    if (areaError) {
      return NextResponse.json(
        { success: false, error: areaError },
        { status: 403 },
      );
    }

    const result = await deleteMonthlySchedule(
      schedule.storeId,
      schedule.yearMonth,
      actor.id,
    );

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      lockedCount: result.lockedCount ?? 0,
    });
  } catch (err) {
    console.error('[DELETE /api/ops/schedules/[id]]', err);

    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
