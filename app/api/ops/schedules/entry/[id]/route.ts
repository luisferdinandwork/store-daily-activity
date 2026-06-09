// app/api/ops/schedules/entry/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  monthlyScheduleEntries,
  monthlySchedules,
} from '@/lib/db/schema';
import { updateMonthlyScheduleEntry } from '@/lib/schedule-utils';

import {
  assertStoreInActorArea,
  getOpsActor,
  normalizeShiftCode,
} from '../../_helpers';

async function resolveId(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const params = await ctx.params;
  return Number(params.id);
}

export async function PATCH(
  req: NextRequest,
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

  const entryId = await resolveId(ctx);

  if (!Number.isInteger(entryId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid entry id.' },
      { status: 400 },
    );
  }

  const [entry] = await db
    .select({
      storeId: monthlySchedules.storeId,
    })
    .from(monthlyScheduleEntries)
    .innerJoin(
      monthlySchedules,
      eq(monthlySchedules.id, monthlyScheduleEntries.monthlyScheduleId),
    )
    .where(eq(monthlyScheduleEntries.id, entryId))
    .limit(1);

  if (!entry) {
    return NextResponse.json(
      { success: false, error: 'Entry not found.' },
      { status: 404 },
    );
  }

  const areaError = await assertStoreInActorArea(actor, entry.storeId);

  if (areaError) {
    return NextResponse.json(
      { success: false, error: areaError },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const patch: {
    shift?: string | null;
    isOff?: boolean;
    isLeave?: boolean;
  } = {};

  if ('shift' in body) {
    patch.shift = normalizeShiftCode(body.shift);
  }

  if ('isOff' in body) {
    patch.isOff = !!body.isOff;
  }

  if ('isLeave' in body) {
    patch.isLeave = !!body.isLeave;
  }

  const result = await updateMonthlyScheduleEntry(entryId, patch, actor.id);

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
