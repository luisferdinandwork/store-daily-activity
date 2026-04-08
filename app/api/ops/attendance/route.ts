// app/api/ops/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { getAttendanceForDate, opsMarkAttendance } from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { breakSessions, shifts }     from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';

// Cache shift id → code lookups in-process
let shiftCodeCache: Map<number, string> | null = null;
async function getShiftCodeMap(): Promise<Map<number, string>> {
  if (shiftCodeCache) return shiftCodeCache;
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  shiftCodeCache = new Map(rows.map(r => [r.id, r.code]));
  return shiftCodeCache;
}

// GET /api/ops/attendance?storeId=...&date=ISO
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const storeIdRaw = req.nextUrl.searchParams.get('storeId');
    const dateStr    = req.nextUrl.searchParams.get('date');

    if (!storeIdRaw || !dateStr) {
      return NextResponse.json(
        { success: false, error: 'storeId and date are required' },
        { status: 400 },
      );
    }

    const storeId = Number(storeIdRaw);
    if (isNaN(storeId)) {
      return NextResponse.json({ success: false, error: 'invalid storeId' }, { status: 400 });
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ success: false, error: 'invalid date' }, { status: 400 });
    }

    const data       = await getAttendanceForDate(storeId, date);
    const shiftCodes = await getShiftCodeMap();

    const serialized = await Promise.all(
      data.map(async ({ schedule, user, attendance }) => {
        let breaks: {
          id:           number;
          breakType:    string;
          breakOutTime: string;
          returnTime:   string | null;
        }[] = [];

        if (attendance) {
          const rows = await db
            .select()
            .from(breakSessions)
            .where(eq(breakSessions.attendanceId, attendance.id))
            .orderBy(breakSessions.breakOutTime);

          breaks = rows.map(b => ({
            id:           b.id,
            breakType:    b.breakType,
            breakOutTime: b.breakOutTime.toISOString(),
            returnTime:   b.returnTime?.toISOString() ?? null,
          }));
        }

        return {
          schedule: {
            id:      schedule.id,
            shiftId: schedule.shiftId,
            shift:   shiftCodes.get(schedule.shiftId) ?? null,    // legacy field for the page
            date:    schedule.date.toISOString(),
          },
          user: user
            ? { id: user.id, name: user.name, employeeTypeId: user.employeeTypeId }
            : null,
          attendance: attendance
            ? {
                id:           attendance.id,
                status:       attendance.status,
                shiftId:      attendance.shiftId,
                shift:        shiftCodes.get(attendance.shiftId) ?? null,
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
    console.error('[GET /api/ops/attendance]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST /api/ops/attendance — body: { scheduleId, status, notes? }
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

    const validStatuses = ['present', 'absent', 'late', 'excused'] as const;
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const schedIdNum = Number(scheduleId);
    if (isNaN(schedIdNum)) {
      return NextResponse.json({ success: false, error: 'invalid scheduleId' }, { status: 400 });
    }

    const result = await opsMarkAttendance(
      schedIdNum,
      status,
      (session.user as any).id as string,
      notes,
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/ops/attendance]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}