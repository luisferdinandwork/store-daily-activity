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
        sched:      schedules,
        att:        attendance,
        shiftCode:  shifts.code,
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
          cashOut:      number;        // always present — NOT NULL in DB
          cashIn:       number | null; // null until employee returns
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
            cashOut:      Number(b.cashOut),                           // decimal → number
            cashIn:       b.cashIn != null ? Number(b.cashIn) : null,  // decimal → number | null
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
// Body:
//   { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift: Shift }
//   startbreak also requires: breakType? (full_day only), cashOut: number
//   endbreak   also requires: cashIn: number

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
    const {
      action,
      shift,
      breakType: rawBreakType,
      cashOut:   rawCashOut,    // present on startbreak
      cashIn:    rawCashIn,     // present on endbreak
    } = body as {
      action:     string;
      shift:      string;
      breakType?: string;
      cashOut?:   number;
      cashIn?:    number;
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
        // ── Validate cashOut ──────────────────────────────────────────────────
        if (rawCashOut == null || isNaN(Number(rawCashOut)) || Number(rawCashOut) < 0) {
          return NextResponse.json(
            { success: false, error: 'cashOut (amount taken out) is required and must be a non-negative number.' },
            { status: 400 },
          );
        }
        const cashOut = Number(rawCashOut);

        // ── Resolve break type ────────────────────────────────────────────────
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

        result = await startBreak(userId, homeStoreId, typedShift, resolvedBreakType, cashOut);
        break;
      }

      case 'endbreak': {
        // ── Validate cashIn ───────────────────────────────────────────────────
        if (rawCashIn == null || isNaN(Number(rawCashIn)) || Number(rawCashIn) < 0) {
          return NextResponse.json(
            { success: false, error: 'cashIn (amount brought back) is required and must be a non-negative number.' },
            { status: 400 },
          );
        }
        const cashIn = Number(rawCashIn);

        // Find the active break session
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
        result = await endBreak(userId, homeStoreId, existing.id, cashIn);
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