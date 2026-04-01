// app/api/ops/schedules/route.ts
//
// POST /api/ops/schedules
// Body: { storeId: string; yearMonth: string }
// Re-materialises schedule rows + tasks for a store+month.
// Called by the "Re-materialise" button in OpsSchedulesPage.
//
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canManageSchedule, materialiseSchedulesForMonth } from '@/lib/schedule-utils';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { storeId, yearMonth } = body ?? {};

    if (!storeId || !yearMonth) {
      return NextResponse.json(
        { success: false, error: 'storeId and yearMonth are required' },
        { status: 400 },
      );
    }

    // Verify the OPS user can manage this store
    const auth = await canManageSchedule(session.user.id, storeId);
    if (!auth.allowed) {
      return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
    }

    const result = await materialiseSchedulesForMonth(storeId, yearMonth);

    if (result.errors.length > 0) {
      console.warn('[POST /api/ops/schedules] partial errors:', result.errors);
    }

    return NextResponse.json({
      success:              true,
      schedulesCreated:     result.schedulesCreated,
      openingTasksCreated:  result.openingTasksCreated,
      groomingTasksCreated: result.groomingTasksCreated,
      errors:               result.errors,
    });
  } catch (err) {
    console.error('[POST /api/ops/schedules]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}