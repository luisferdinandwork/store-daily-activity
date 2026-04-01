// app/api/ops/schedules/[id]/route.ts
//
// DELETE /api/ops/schedules/[id]
// Deletes a monthly schedule by its ID. Attended days are preserved.
//
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { monthlySchedules } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { deleteMonthlySchedule } from '@/lib/schedule-utils';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  try {
    // Look up the schedule to get storeId + yearMonth for the utility fn
    const [ms] = await db
      .select({
        storeId:   monthlySchedules.storeId,
        yearMonth: monthlySchedules.yearMonth,
      })
      .from(monthlySchedules)
      .where(eq(monthlySchedules.id, id))
      .limit(1);

    if (!ms) {
      return NextResponse.json({ success: false, error: 'Schedule not found' }, { status: 404 });
    }

    const result = await deleteMonthlySchedule(ms.storeId, ms.yearMonth, session.user.id);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, lockedCount: result.lockedCount ?? 0 });
  } catch (err) {
    console.error('[DELETE /api/ops/schedules/[id]]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}