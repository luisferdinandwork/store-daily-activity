// app/api/employee/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  employeeCheckIn,
  employeeCheckOut,
  startBreak,
  endBreak,
} from '@/lib/schedule-utils';
import { db } from '@/lib/db';
import { schedules, attendance, breakSessions } from '@/lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0);      return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

// ─── GET /api/employee/attendance ─────────────────────────────────────────────
// Returns ALL of today's schedules + their attendance records (one per shift).
// An employee may have both morning and evening shifts on the same day.
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId  = (session.user as any).id      as string;
    const storeId = (session.user as any).storeId  as string;

    if (!storeId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store' },
        { status: 400 },
      );
    }

    const now = new Date();

    // All schedules today for this employee (may be 0, 1, or 2 — one per shift)
    const todaySchedules = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.userId,    userId),
          eq(schedules.storeId,   storeId),
          eq(schedules.isHoliday, false),
          gte(schedules.date,     startOfDay(now)),
          lte(schedules.date,     endOfDay(now)),
        ),
      )
      .orderBy(schedules.shift); // morning first, then evening

    // For each schedule, find attendance + breaks
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
// Body: { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift?: 'morning'|'evening' }
// `shift` is required for checkin; for checkout/break actions the server looks
// up the attendance record from today's DB row so the client doesn't need to send it.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId  = (session.user as any).id      as string;
    const storeId = (session.user as any).storeId  as string;

    if (!storeId) {
      return NextResponse.json(
        { success: false, error: 'User is not assigned to a store' },
        { status: 400 },
      );
    }

    const { action, shift } = await req.json();

    // ── Check In ──────────────────────────────────────────────────────────────
    if (action === 'checkin') {
      if (!shift || !['morning', 'evening'].includes(shift)) {
        return NextResponse.json(
          { success: false, error: 'shift must be "morning" or "evening"' },
          { status: 400 },
        );
      }
      const result = await employeeCheckIn(userId, storeId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── Check Out ─────────────────────────────────────────────────────────────
    // shift required so we check out the right shift when both are active
    if (action === 'checkout') {
      if (!shift || !['morning', 'evening'].includes(shift)) {
        return NextResponse.json(
          { success: false, error: 'shift must be "morning" or "evening" for checkout' },
          { status: 400 },
        );
      }
      const result = await employeeCheckOut(userId, storeId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── Start Break ───────────────────────────────────────────────────────────
    // shift required so we start break on the right shift
    if (action === 'startbreak') {
      if (!shift || !['morning', 'evening'].includes(shift)) {
        return NextResponse.json(
          { success: false, error: 'shift must be "morning" or "evening" for startbreak' },
          { status: 400 },
        );
      }
      const result = await startBreak(userId, storeId, shift);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // ── End Break ─────────────────────────────────────────────────────────────
    if (action === 'endbreak') {
      if (!shift || !['morning', 'evening'].includes(shift)) {
        return NextResponse.json(
          { success: false, error: 'shift must be "morning" or "evening" for endbreak' },
          { status: 400 },
        );
      }

      const now = new Date();
      // Find the attendance record for this specific shift today
      const [sched] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId,    userId),
            eq(schedules.storeId,   storeId),
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

      const result = await endBreak(userId, storeId, att.id);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json(
      { success: false, error: 'action must be "checkin", "checkout", "startbreak", or "endbreak"' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}