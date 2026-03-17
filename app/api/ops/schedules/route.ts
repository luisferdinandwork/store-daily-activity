// app/api/ops/schedules/route.ts
//
// POST /api/ops/schedules
//
// OPS can trigger a re-materialisation of schedules for a store+month,
// or get the list of monthly schedules for a store.
//
// GET  /api/ops/schedules?storeId=...&yearMonth=...
//   Returns the monthly schedule with all entries for a specific store+month.
//
// POST /api/ops/schedules
//   Body: { storeId, yearMonth }
//   Triggers materialiseSchedulesForMonth for that store+month.
//   OPS can use this to fix missing schedule rows after a manual DB edit.

import { NextRequest, NextResponse }        from 'next/server';
import { getServerSession }                 from 'next-auth';
import { authOptions }                      from '@/lib/auth';
import {
  getMonthlySchedule,
  materialiseSchedulesForMonth,
  canManageSchedule,
} from '@/lib/schedule-utils';

function guardOps(session: any): { userId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.role !== 'ops') return null;
  return { userId: u.id };
}

// GET /api/ops/schedules?storeId=...&yearMonth=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can access schedules.' },
        { status: 403 },
      );
    }

    const storeId   = req.nextUrl.searchParams.get('storeId');
    const yearMonth = req.nextUrl.searchParams.get('yearMonth');

    if (!storeId || !yearMonth) {
      return NextResponse.json(
        { success: false, error: 'storeId and yearMonth are required.' },
        { status: 400 },
      );
    }

    // Verify OPS has access to this store
    const auth = await canManageSchedule(actor.userId, storeId);
    if (!auth.allowed) {
      return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
    }

    const result = await getMonthlySchedule(storeId, yearMonth);
    if (!result) {
      return NextResponse.json({ success: true, schedule: null });
    }

    return NextResponse.json({
      success:  true,
      schedule: {
        ...result.schedule,
        entries: result.entries.map(e => ({
          id:       e.id,
          userId:   e.userId,
          userName: e.userName,
          userType: e.userEmployeeType,
          date:     e.date,
          shift:    e.shift,
          isOff:    e.isOff,
          isLeave:  e.isLeave,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST /api/ops/schedules
// Body: { storeId, yearMonth }
// Re-runs materialisation for the given store+month. Safe to call multiple times.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can trigger materialisation.' },
        { status: 403 },
      );
    }

    const { storeId, yearMonth } = await req.json();

    if (!storeId || !yearMonth) {
      return NextResponse.json(
        { success: false, error: 'storeId and yearMonth are required.' },
        { status: 400 },
      );
    }

    const auth = await canManageSchedule(actor.userId, storeId);
    if (!auth.allowed) {
      return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
    }

    const result = await materialiseSchedulesForMonth(storeId, yearMonth);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}