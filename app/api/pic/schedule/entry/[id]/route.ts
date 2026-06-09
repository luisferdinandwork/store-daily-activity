// app/api/pic/schedule/entry/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { updateMonthlyScheduleEntry } from '@/lib/schedule-utils';

import {
  canManageSchedule,
  resolveActorCodes,
} from '../../_utils';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const user = session.user as any;
  const actorId = user.id as string;

  const { role, empType } = await resolveActorCodes(actorId);

  if (!canManageSchedule(role, empType)) {
    return NextResponse.json(
      { success: false, error: 'Only OPS or PIC 1 can edit schedule entries.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const entryId = Number(id);

  if (Number.isNaN(entryId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid entry id.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const patch: {
    shift?: string | null;
    isOff?: boolean;
    isLeave?: boolean;
  } = {};

  if ('shift' in body) {
    patch.shift =
      typeof body.shift === 'string' && body.shift.trim()
        ? body.shift.trim()
        : null;
  }

  if ('isOff' in body) {
    patch.isOff = !!body.isOff;
  }

  if ('isLeave' in body) {
    patch.isLeave = !!body.isLeave;
  }

  const result = await updateMonthlyScheduleEntry(entryId, patch, actorId);

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}