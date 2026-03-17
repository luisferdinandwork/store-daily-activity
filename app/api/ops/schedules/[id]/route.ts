// app/api/ops/schedules/[id]/route.ts
//
// DELETE /api/ops/schedules/[id]
//   Deletes a monthly schedule (unattended days only) for a given store+month.
//   The [id] here is the monthlySchedule id.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { deleteMonthlySchedule }     from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { monthlySchedules }          from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';

function guardOps(session: any): { userId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.role !== 'ops') return null;
  return { userId: u.id };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can delete schedules.' },
        { status: 403 },
      );
    }

    const { id } = await params;

    // Look up the monthly schedule to get storeId + yearMonth
    const [ms] = await db
      .select({ storeId: monthlySchedules.storeId, yearMonth: monthlySchedules.yearMonth })
      .from(monthlySchedules)
      .where(eq(monthlySchedules.id, id))
      .limit(1);

    if (!ms) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found.' },
        { status: 404 },
      );
    }

    const result = await deleteMonthlySchedule(ms.storeId, ms.yearMonth, actor.userId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}