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
import { schedules, attendance, breakSessions } from '@/lib/db/schema';
import { and, eq, gte, lte }         from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0);      return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

/**
 * Resolves the store the employee is actually working at TODAY.
 *
 * An employee's session carries their homeStoreId. But if they have been
 * deployed to a different store this month, their schedule rows will have
 * a different storeId. We look up their actual schedule for today and return
 * that storeId so check-in/out targets the correct store.
 *
 * Falls back to homeStoreId if no schedule is found today (will result in
 * the usual "not scheduled" error from employeeCheckIn).
 */
async function resolveWorkingStoreId(userId: string, homeStoreId: string): Promise<string> {
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
// Returns ALL of today's schedules + their attendance records (one per shift).
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId      = (session.user as any).id          as string;
    const homeStoreId = (session.user as any).homeStoreId as string | undefined;

    if (!homeStoreId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store.' },
        { status: 400 },
      );
    }

    const now = new Date();

    // All schedules today for this employee across ALL stores
    // (employee may be deployed to a store other than their home store)
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
      .orderBy(schedules.shift);   // morning first, then evening

    // For each schedule, fetch attendance + break sessions
    const shifts = await Promise.all(
      todaySchedules.map(async (sched) => {
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

        return {
          schedule: {
            scheduleId: sched.id,
            shift:      sched.shift as 'morning' | 'evening',
            storeId:    sched.storeId,
            date:       sched.date.toISOString(),
          },
          attendance: att
            ? {
                attendanceId:  att.id,
                scheduleId:    att.scheduleId,
                status:        att.status,
                shift:         att.shift,
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

    return NextResponse.json({ success: true, shifts });
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

    const userId      = (session.user as any).id          as string;
    const homeStoreId = (session.user as any).homeStoreId as string | undefined;

    if (!homeStoreId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store.' },
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

    // Resolve working store for this employee today (handles cross-store deployments)
    const workingStoreId = await resolveWorkingStoreId(userId, homeStoreId);

    // ── Check In ──────────────────────────────────────────────────────────────
    if (action === 'checkin') {
      const result = await employeeCheckIn(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── Check Out ─────────────────────────────────────────────────────────────
    if (action === 'checkout') {
      const result = await employeeCheckOut(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── Start Break ───────────────────────────────────────────────────────────
    if (action === 'startbreak') {
      const result = await startBreak(userId, workingStoreId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── End Break ─────────────────────────────────────────────────────────────
    if (action === 'endbreak') {
      const now = new Date();

      // Look up today's schedule for this specific shift
      const [sched] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId,    userId),
            eq(schedules.storeId,   workingStoreId),
            eq(schedules.shift,     shift),
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