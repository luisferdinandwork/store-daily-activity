// app/api/employee/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  employeeCheckIn,
  employeeCheckOut,
  startBreak,
  endBreak,
}                                    from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { schedules, attendance, breakSessions, shifts } from '@/lib/db/schema';
import { and, eq, gte, lte }         from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0);      return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

/** Cache shift code→id map */
let _shiftCache: Record<string, number> | null = null;
async function getShiftIdMap(): Promise<Record<string, number>> {
  if (_shiftCache) return _shiftCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  _shiftCache = Object.fromEntries(rows.map(r => [r.code, r.id]));
  return _shiftCache!;
}

/** Build reverse map: id → code */
async function getShiftCodeMap(): Promise<Record<number, string>> {
  const fwd = await getShiftIdMap();
  return Object.fromEntries(Object.entries(fwd).map(([code, id]) => [id, code]));
}

/**
 * Resolves the store the employee is actually working at TODAY.
 * Returns the storeId as a number (serial PK in schema).
 */
async function resolveWorkingStoreId(userId: string, homeStoreId: number): Promise<number> {
  const now = new Date();
  const [sched] = await db
    .select({ storeId: schedules.storeId })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId,    userId),
        eq(schedules.isHoliday, false),
        gte(schedules.date,     startOfDay(now)),
        lte(schedules.date,     endOfDay(now)),
      ),
    )
    .limit(1);

  return sched?.storeId ?? homeStoreId;
}

// ─── GET /api/employee/attendance ─────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId         = (session.user as any).id          as string;
    const rawHomeStoreId = (session.user as any).homeStoreId as string | number | undefined;

    if (!rawHomeStoreId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store.' },
        { status: 400 },
      );
    }

    const homeStoreId = Number(rawHomeStoreId);
    if (isNaN(homeStoreId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid homeStoreId in session.' },
        { status: 400 },
      );
    }

    const now = new Date();
    const shiftCodeMap = await getShiftCodeMap();

    const todaySchedules = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     startOfDay(now)),
          lte(schedules.date,     endOfDay(now)),
        ),
      )
      .orderBy(schedules.shiftId);

    const shiftValues = ['morning', 'evening'] as const;
    type ShiftCode = typeof shiftValues[number];

    const shifts_result = await Promise.all(
      todaySchedules.map(async (sched) => {
        const shiftCode = (shiftCodeMap[sched.shiftId] ?? 'morning') as ShiftCode;

        const [att] = await db
          .select()
          .from(attendance)
          .where(eq(attendance.scheduleId, sched.id))
          .limit(1);

        const breaks = att
          ? await db
              .select()
              .from(breakSessions)
              .where(eq(breakSessions.attendanceId, att.id))
              .orderBy(breakSessions.breakOutTime)
          : [];

        const attShiftCode = att ? (shiftCodeMap[att.shiftId] ?? shiftCode) as ShiftCode : shiftCode;

        return {
          schedule: {
            scheduleId: sched.id,
            shift:      shiftCode,
            storeId:    sched.storeId,
            date:       sched.date.toISOString(),
          },
          attendance: att
            ? {
                attendanceId:  att.id,
                scheduleId:    att.scheduleId,
                status:        att.status,
                shift:         attShiftCode,
                checkInTime:   att.checkInTime?.toISOString()  ?? null,
                checkOutTime:  att.checkOutTime?.toISOString() ?? null,
                onBreak:       att.onBreak,
                notes:         att.notes,
                breaks: breaks.map(b => ({
                  id:           b.id,
                  breakType:    b.breakType,
                  breakOutTime: b.breakOutTime.toISOString(),
                  returnTime:   b.returnTime?.toISOString() ?? null,
                })),
              }
            : null,
        };
      }),
    );

    return NextResponse.json({ success: true, shifts: shifts_result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── POST /api/employee/attendance ────────────────────────────────────────────
// Body: { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift: 'morning'|'evening' }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId         = (session.user as any).id          as string;
    const rawHomeStoreId = (session.user as any).homeStoreId as string | number | undefined;

    if (!rawHomeStoreId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store.' },
        { status: 400 },
      );
    }

    const homeStoreId = Number(rawHomeStoreId);
    if (isNaN(homeStoreId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid homeStoreId in session.' },
        { status: 400 },
      );
    }

    const { action, shift } = await req.json();

    if (!shift || !['morning', 'evening'].includes(shift)) {
      return NextResponse.json(
        { success: false, error: 'shift must be "morning" or "evening".' },
        { status: 400 },
      );
    }

    const workingStoreId = await resolveWorkingStoreId(userId, homeStoreId);

    if (action === 'checkin') {
      const result = await employeeCheckIn(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'checkout') {
      const result = await employeeCheckOut(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'startbreak') {
      const result = await startBreak(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'endbreak') {
      const now = new Date();
      const shiftMap = await getShiftIdMap();
      const shiftIdToUse = shiftMap[shift];

      if (!shiftIdToUse) {
        return NextResponse.json(
          { success: false, error: `Invalid shift: ${shift}` },
          { status: 400 },
        );
      }

      const [sched] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId,    userId),
            eq(schedules.storeId,   workingStoreId),
            eq(schedules.shiftId,   shiftIdToUse),
            eq(schedules.isHoliday, false),
            gte(schedules.date,     startOfDay(now)),
            lte(schedules.date,     endOfDay(now)),
          ),
        )
        .limit(1);

      if (!sched) {
        return NextResponse.json(
          { success: false, error: `No ${shift} schedule found for today.` },
          { status: 400 },
        );
      }

      const [att] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(eq(attendance.scheduleId, sched.id))
        .limit(1);

      if (!att) {
        return NextResponse.json(
          { success: false, error: 'No attendance record found for this shift.' },
          { status: 400 },
        );
      }

      const result = await endBreak(userId, workingStoreId, att.id);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json(
      { success: false, error: 'action must be "checkin", "checkout", "startbreak", or "endbreak".' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}