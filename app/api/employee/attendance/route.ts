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
import type { Shift, BreakType } from '@/lib/schedule-utils';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0);      return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }

// ─── GET /api/employee/attendance ─────────────────────────────────────────────
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

    // Pull every schedule for today (morning, evening, or full_day)
    const rows = await db
      .select({
        sched:     schedules,
        att:       attendance,
        shiftCode: shifts.code,
        shiftLabel: shifts.label,
        startTime:  shifts.startTime,
        endTime:    shifts.endTime,
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
      rows.map(async ({ sched, att, shiftCode, shiftLabel, startTime, endTime }) => {
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
            shift:      shiftCode as Shift,
            shiftLabel,
            startTime:  startTime ?? null,
            endTime:    endTime   ?? null,
            storeId:    sched.storeId,
            date:       sched.date.toISOString(),
          },
          attendance: att
            ? {
                attendanceId: att.id,
                scheduleId:   sched.id,
                status:       att.status,
                shift:        shiftCode as Shift,
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

// ─── POST /api/employee/attendance ────────────────────────────────────────────
// Body: { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift: Shift, breakType?: BreakType }
//
// `breakType` is required for `startbreak` on full_day shifts (the caller must
// specify 'full_day_lunch' or 'full_day_dinner'). For morning/evening it
// defaults to the shift's single allowed break type.

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

    const body = await req.json();
    const { action, shift, breakType: rawBreakType } = body as {
      action:     string;
      shift:      string;
      breakType?: string;
    };

    if (!action || !shift) {
      return NextResponse.json({ success: false, error: 'action and shift are required.' }, { status: 400 });
    }

    const validShifts: Shift[] = ['morning', 'evening', 'full_day'];
    if (!validShifts.includes(shift as Shift)) {
      return NextResponse.json({ success: false, error: `Invalid shift "${shift}".` }, { status: 400 });
    }
    const typedShift = shift as Shift;

    let result;

    switch (action) {

      case 'checkin':
        result = await employeeCheckIn(userId, homeStoreId, typedShift);
        break;

      case 'checkout':
        result = await employeeCheckOut(userId, homeStoreId, typedShift);
        break;

      case 'startbreak': {
        // Resolve the break type:
        //   - morning  → always 'lunch'
        //   - evening  → always 'dinner'
        //   - full_day → caller must supply 'full_day_lunch' or 'full_day_dinner'
        let resolvedBreakType: BreakType;

        if (typedShift === 'morning') {
          resolvedBreakType = 'lunch';
        } else if (typedShift === 'evening') {
          resolvedBreakType = 'dinner';
        } else {
          // full_day — require explicit breakType from caller
          const validFullDayBreaks: BreakType[] = ['full_day_lunch', 'full_day_dinner'];
          if (!rawBreakType || !validFullDayBreaks.includes(rawBreakType as BreakType)) {
            return NextResponse.json(
              { success: false, error: 'Full-day shifts require breakType: "full_day_lunch" or "full_day_dinner".' },
              { status: 400 },
            );
          }
          resolvedBreakType = rawBreakType as BreakType;
        }

        result = await startBreak(userId, homeStoreId, typedShift, resolvedBreakType);
        break;
      }

      case 'endbreak': {
        // Find the active break session — no shift filtering needed since there
        // should only be one open break per employee per day.
        const [existing] = await db
          .select({ id: attendance.id })
          .from(attendance)
          .innerJoin(schedules, eq(attendance.scheduleId, schedules.id))
          .innerJoin(shifts,    eq(schedules.shiftId,     shifts.id))
          .where(
            and(
              eq(attendance.userId,  userId),
              eq(attendance.storeId, homeStoreId),
              eq(shifts.code,        typedShift),
              eq(attendance.onBreak, true),
            ),
          )
          .limit(1);

        if (!existing) {
          return NextResponse.json({ success: false, error: 'No active break found.' }, { status: 400 });
        }
        result = await endBreak(userId, homeStoreId, existing.id);
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action "${action}".` }, { status: 400 });
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/attendance]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}