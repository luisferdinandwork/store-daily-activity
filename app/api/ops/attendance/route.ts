// app/api/ops/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttendanceForDate, opsMarkAttendance } from '@/lib/schedule-utils';
import { db } from '@/lib/db';
import { breakSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// GET /api/ops/attendance?storeId=...&date=ISO
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const storeId = req.nextUrl.searchParams.get('storeId');
    const dateStr = req.nextUrl.searchParams.get('date');

    if (!storeId || !dateStr) {
      return NextResponse.json(
        { success: false, error: 'storeId and date are required' },
        { status: 400 },
      );
    }

    const data = await getAttendanceForDate(storeId, new Date(dateStr));

    // For each row that has an attendance record, fetch its break sessions
    const serialized = await Promise.all(
      data.map(async ({ schedule, user, attendance }) => {
        let breaks: {
          id: string;
          breakType: string;
          breakOutTime: string;
          returnTime: string | null;
        }[] = [];

        if (attendance) {
          const rows = await db
            .select()
            .from(breakSessions)
            .where(eq(breakSessions.attendanceId, attendance.id))
            .orderBy(breakSessions.breakOutTime);

          breaks = rows.map((b) => ({
            id:           b.id,
            breakType:    b.breakType,
            breakOutTime: b.breakOutTime.toISOString(),
            returnTime:   b.returnTime?.toISOString() ?? null,
          }));
        }

        return {
          schedule: {
            id:    schedule.id,
            shift: schedule.shift,
            date:  schedule.date.toISOString(),
          },
          user: user
            ? { id: user.id, name: user.name, employeeType: user.employeeType }
            : null,
          attendance: attendance
            ? {
                id:           attendance.id,
                status:       attendance.status,
                checkInTime:  attendance.checkInTime?.toISOString()  ?? null,
                checkOutTime: attendance.checkOutTime?.toISOString() ?? null,
                onBreak:      attendance.onBreak,
                notes:        attendance.notes,
                breaks,
              }
            : null,
        };
      }),
    );

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST /api/ops/attendance
// Body: { scheduleId, status, notes? }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { scheduleId, status, notes } = await req.json();

    if (!scheduleId || !status) {
      return NextResponse.json(
        { success: false, error: 'scheduleId and status are required' },
        { status: 400 },
      );
    }

    const validStatuses = ['present', 'absent', 'late', 'excused'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const result = await opsMarkAttendance(
      scheduleId,
      status,
      (session.user as any).id,
      notes,
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}