// app/api/employee/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { db }                        from '@/lib/db';
import {
  schedules, attendance, breakSessions, shifts,
} from '@/lib/db/schema';
import { eq, and, gte, lte }         from 'drizzle-orm';
import {
  employeeCheckIn, employeeCheckOut, startBreak, endBreak,
} from '@/lib/schedule-utils';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0);      return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }

// GET /api/employee/attendance → today's shift slots for the signed-in user
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const user        = session.user as any;
    const userId      = user.id as string;
    const homeStoreId = user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || isNaN(homeStoreId)) {
      return NextResponse.json({ success: true, shifts: [] });
    }

    const now      = new Date();
    const dayStart = startOfDay(now);
    const dayEnd   = endOfDay(now);

    // Pull every schedule for today (could be morning + evening = 2 rows)
    const rows = await db
      .select({
        sched:     schedules,
        att:       attendance,
        shiftCode: shifts.code,
      })
      .from(schedules)
      .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.storeId,   homeStoreId),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     dayStart),
          lte(schedules.date,     dayEnd),
        ),
      )
      .orderBy(shifts.sortOrder);

    const shiftSlots = await Promise.all(
      rows.map(async ({ sched, att, shiftCode }) => {
        let breaks: {
          id:           number;
          breakType:    string;
          breakOutTime: string;
          returnTime:   string | null;
        }[] = [];

        if (att) {
          const brkRows = await db
            .select()
            .from(breakSessions)
            .where(eq(breakSessions.attendanceId, att.id))
            .orderBy(breakSessions.breakOutTime);
          breaks = brkRows.map(b => ({
            id:           b.id,
            breakType:    b.breakType,
            breakOutTime: b.breakOutTime.toISOString(),
            returnTime:   b.returnTime?.toISOString() ?? null,
          }));
        }

        return {
          schedule: {
            scheduleId: sched.id,
            shift:      shiftCode,                    // 'morning' | 'evening' for the page
            storeId:    sched.storeId,
            date:       sched.date.toISOString(),
          },
          attendance: att
            ? {
                attendanceId: att.id,
                scheduleId:   sched.id,
                status:       att.status,
                shift:        shiftCode,
                checkInTime:  att.checkInTime?.toISOString()  ?? null,
                checkOutTime: att.checkOutTime?.toISOString() ?? null,
                onBreak:      att.onBreak,
                notes:        att.notes,
                breaks,
              }
            : null,
        };
      }),
    );

    return NextResponse.json({ success: true, shifts: shiftSlots });
  } catch (err) {
    console.error('[GET /api/employee/attendance]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST /api/employee/attendance — body: { action, shift }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const user        = session.user as any;
    const userId      = user.id as string;
    const homeStoreId = user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || isNaN(homeStoreId)) {
      return NextResponse.json({ success: false, error: 'No home store assigned.' }, { status: 400 });
    }

    const { action, shift } = await req.json();
    if (!action || !shift) {
      return NextResponse.json({ success: false, error: 'action and shift are required' }, { status: 400 });
    }
    if (shift !== 'morning' && shift !== 'evening') {
      return NextResponse.json({ success: false, error: 'invalid shift' }, { status: 400 });
    }

    let result;
    switch (action) {
      case 'checkin':
        result = await employeeCheckIn(userId, homeStoreId, shift);
        break;
      case 'checkout':
        result = await employeeCheckOut(userId, homeStoreId, shift);
        break;
      case 'startbreak':
        result = await startBreak(userId, homeStoreId, shift);
        break;
      case 'endbreak': {
        // endBreak needs the attendanceId — look it up first
        const [existing] = await db
          .select({ id: attendance.id })
          .from(attendance)
          .innerJoin(schedules, eq(attendance.scheduleId, schedules.id))
          .innerJoin(shifts,    eq(schedules.shiftId,     shifts.id))
          .where(
            and(
              eq(attendance.userId,  userId),
              eq(attendance.storeId, homeStoreId),
              eq(shifts.code,        shift),
              eq(attendance.onBreak, true),
            ),
          )
          .limit(1);
        if (!existing) {
          return NextResponse.json({ success: false, error: 'No active break found' }, { status: 400 });
        }
        result = await endBreak(userId, homeStoreId, existing.id);
        break;
      }
      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/attendance]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}