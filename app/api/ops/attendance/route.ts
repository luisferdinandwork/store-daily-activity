// app/api/ops/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { getAttendanceForDate, opsMarkAttendance, autoCheckoutOverdueAttendance, autoMarkAbsentPastSchedules } from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { breakSessions, shifts, employeeTypes } from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';

// Cache shift id → full shift info lookups in-process. Shifts are dynamic
// (morning/evening/full_day today, more can be added later), so the page
// needs real label/time/icon data rather than assuming a fixed set of codes
// — this is what let PIC 1's full-day shift silently vanish from the list
// before: the frontend only knew how to group "morning" and "evening".
interface ShiftInfo {
  code:      string;
  label:     string;
  startTime: string | null;
  endTime:   string | null;
  icon:      string | null;
  accent:    string | null;
  sortOrder: number;
}
let shiftInfoCache: Map<number, ShiftInfo> | null = null;
async function getShiftInfoMap(): Promise<Map<number, ShiftInfo>> {
  if (shiftInfoCache) return shiftInfoCache;
  const rows = await db
    .select({
      id:        shifts.id,
      code:      shifts.code,
      label:     shifts.label,
      startTime: shifts.startTime,
      endTime:   shifts.endTime,
      icon:      shifts.icon,
      accent:    shifts.accent,
      sortOrder: shifts.sortOrder,
    })
    .from(shifts);
  shiftInfoCache = new Map(rows.map(r => [r.id, {
    code: r.code, label: r.label, startTime: r.startTime, endTime: r.endTime,
    icon: r.icon, accent: r.accent, sortOrder: r.sortOrder,
  }]));
  return shiftInfoCache;
}

// Cache employeeType id → { code, label } lookups in-process
let empTypeCache: Map<number, { code: string; label: string }> | null = null;
async function getEmpTypeMap(): Promise<Map<number, { code: string; label: string }>> {
  if (empTypeCache) return empTypeCache;
  const rows = await db.select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label }).from(employeeTypes);
  empTypeCache = new Map(rows.map(r => [r.id, { code: r.code, label: r.label }]));
  return empTypeCache;
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

    // Close out anyone in this store left checked-in past their shift end,
    // and mark absent anyone from a past day who never got an attendance
    // record at all — both mirror the employee-side lazy fixers.
    await autoCheckoutOverdueAttendance({ storeIds: [storeId] });
    await autoMarkAbsentPastSchedules({ storeIds: [storeId] });

    const data      = await getAttendanceForDate(storeId, date);
    const shiftInfo = await getShiftInfoMap();
    const empTypes  = await getEmpTypeMap();

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

        const schedShift = shiftInfo.get(schedule.shiftId) ?? null;

        return {
          schedule: {
            id:        schedule.id,
            shiftId:   schedule.shiftId,
            shift:     schedShift?.code  ?? null,    // legacy field for the page
            shiftLabel:     schedShift?.label     ?? null,
            shiftStartTime: schedShift?.startTime ?? null,
            shiftEndTime:   schedShift?.endTime   ?? null,
            shiftIcon:      schedShift?.icon      ?? null,
            shiftAccent:    schedShift?.accent    ?? null,
            shiftSortOrder: schedShift?.sortOrder ?? 0,
            date:      schedule.date.toISOString(),
          },
          user: user
            ? {
                id:            user.id,
                name:          user.name,
                employeeType:      user.employeeTypeId ? (empTypes.get(user.employeeTypeId)?.code  ?? null) : null,
                employeeTypeLabel: user.employeeTypeId ? (empTypes.get(user.employeeTypeId)?.label ?? null) : null,
              }
            : null,
          attendance: attendance
            ? {
                id:           attendance.id,
                status:       attendance.status,
                shiftId:      attendance.shiftId,
                shift:        shiftInfo.get(attendance.shiftId)?.code ?? null,
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