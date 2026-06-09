// app/api/ops/schedules/shifts/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { asc, eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts } from '@/lib/db/schema';

import { getOpsActor } from '../_helpers';

export async function GET() {
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

  const rows = await db
    .select({
      id: shifts.id,
      code: shifts.code,
      label: shifts.label,
      description: shifts.description,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      accent: shifts.accent,
      icon: shifts.icon,
      breaks: shifts.breaks,
      isActive: shifts.isActive,
      sortOrder: shifts.sortOrder,
    })
    .from(shifts)
    .where(eq(shifts.isActive, true))
    .orderBy(asc(shifts.sortOrder), asc(shifts.id));

  return NextResponse.json({
    success: true,
    shifts: rows,
  });
}
