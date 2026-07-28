// app/api/employee/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { asc, and, eq, gte, lte } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  schedules,
  attendance,
  breakSessions,
  shifts,
} from '@/lib/db/schema';

import {
  employeeCheckIn,
  employeeCheckOut,
  startBreak,
  endBreak,
  todayInStoreTimezone,
} from '@/lib/schedule-utils';

import type { Shift, BreakType } from '@/lib/schedule-utils';

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/**
 * Keep this list aligned with your break_type enum.
 * If your DB enum only accepts these values, never send anything else into
 * startBreak(), or the insert into break_sessions will fail.
 */
const VALID_BREAK_TYPES = [
  'lunch',
  'dinner',
  'full_day_lunch',
  'full_day_dinner',
] as const satisfies readonly BreakType[];

type ShiftBreakDef = {
  type: BreakType;
  label: string;
  durationMinutes?: number | null;
};

function isValidBreakType(value: unknown): value is BreakType {
  return (
    typeof value === 'string' &&
    (VALID_BREAK_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Supports both formats:
 *
 * shifts.breaks = [
 *   { type: "lunch", label: "Lunch" }
 * ]
 *
 * or older/simple data:
 *
 * shifts.breaks = ["lunch", "dinner"]
 */
function parseShiftBreaks(raw: unknown): ShiftBreakDef[] {
  if (!Array.isArray(raw)) return [];

  const result: ShiftBreakDef[] = [];

  for (const item of raw) {
    if (typeof item === 'string') {
      if (isValidBreakType(item)) {
        result.push({
          type: item,
          label: humanizeBreakType(item),
        });
      }
      continue;
    }

    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const type = obj.type;

      if (!isValidBreakType(type)) continue;

      result.push({
        type,
        label:
          typeof obj.label === 'string' && obj.label.trim()
            ? obj.label.trim()
            : humanizeBreakType(type),
        durationMinutes:
          typeof obj.durationMinutes === 'number'
            ? obj.durationMinutes
            : typeof obj.duration === 'number'
              ? obj.duration
              : null,
      });
    }
  }

  return result;
}

function humanizeBreakType(type: BreakType) {
  switch (type) {
    case 'lunch':
      return 'Lunch';
    case 'dinner':
      return 'Dinner';
    case 'full_day_lunch':
      return 'Full Day Lunch';
    case 'full_day_dinner':
      return 'Full Day Dinner';
    default:
      return type;
  }
}

/**
 * Backward-compatible fallback.
 *
 * This keeps attendance working even when old shift rows do not have
 * shifts.breaks populated yet.
 */
function fallbackBreaksForShiftCode(shiftCode: string): ShiftBreakDef[] {
  if (shiftCode === 'morning') {
    return [{ type: 'lunch', label: 'Lunch' }];
  }

  if (shiftCode === 'evening') {
    return [{ type: 'dinner', label: 'Dinner' }];
  }

  if (shiftCode === 'full_day') {
    return [
      { type: 'full_day_lunch', label: 'Full Day Lunch' },
      { type: 'full_day_dinner', label: 'Full Day Dinner' },
    ];
  }

  return [];
}

function getShiftBreaks(rawBreaks: unknown, shiftCode: string): ShiftBreakDef[] {
  const configured = parseShiftBreaks(rawBreaks);
  return configured.length ? configured : fallbackBreaksForShiftCode(shiftCode);
}

async function getTodayScheduleForShift(params: {
  userId: string;
  storeId: number;
  shiftCode: string;
}) {
  const today = todayInStoreTimezone();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const [row] = await db
    .select({
      sched: schedules,
      shift: shifts,
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .where(
      and(
        eq(schedules.userId, params.userId),
        eq(schedules.storeId, params.storeId),
        eq(schedules.isHoliday, false),
        eq(shifts.code, params.shiftCode),
        eq(shifts.isActive, true),
        gte(schedules.date, dayStart),
        lte(schedules.date, dayEnd),
      ),
    )
    .limit(1);

  return row ?? null;
}

// ─── GET /api/employee/attendance ─────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const user = session.user as any;
    const userId = user.id as string;
    const homeStoreId =
      user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || Number.isNaN(homeStoreId)) {
      return NextResponse.json({ success: true, shifts: [] });
    }

    const today = todayInStoreTimezone();
    const dayStart = startOfDay(today);
    const dayEnd = endOfDay(today);

    const rows = await db
      .select({
        sched: schedules,
        att: attendance,

        shiftId: shifts.id,
        shiftCode: shifts.code,
        shiftLabel: shifts.label,
        shiftDescription: shifts.description,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
        accent: shifts.accent,
        icon: shifts.icon,
        shiftBreaks: shifts.breaks,
        shiftSortOrder: shifts.sortOrder,
      })
      .from(schedules)
      .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.storeId, homeStoreId),
          eq(schedules.isHoliday, false),
          eq(shifts.isActive, true),
          gte(schedules.date, dayStart),
          lte(schedules.date, dayEnd),
        ),
      )
      .orderBy(asc(shifts.sortOrder), asc(shifts.id));

    const shiftSlots = await Promise.all(
      rows.map(
        async ({
          sched,
          att,
          shiftId,
          shiftCode,
          shiftLabel,
          shiftDescription,
          startTime,
          endTime,
          accent,
          icon,
          shiftBreaks,
          shiftSortOrder,
        }) => {
          let breaks: {
            id: number;
            breakType: string;
            breakLabel: string;
            breakOutTime: string;
            returnTime: string | null;
            cashOut: number;
            cashIn: number | null;
          }[] = [];

          const configuredBreaks = getShiftBreaks(shiftBreaks, shiftCode);
          const breakLabelByType = new Map(
            configuredBreaks.map((b) => [b.type, b.label]),
          );

          if (att) {
            const brkRows = await db
              .select()
              .from(breakSessions)
              .where(eq(breakSessions.attendanceId, att.id))
              .orderBy(asc(breakSessions.breakOutTime));

            breaks = brkRows.map((b) => ({
              id: b.id,
              breakType: b.breakType,
              breakLabel:
                breakLabelByType.get(b.breakType as BreakType) ??
                humanizeBreakType(b.breakType as BreakType),
              breakOutTime: b.breakOutTime.toISOString(),
              returnTime: b.returnTime?.toISOString() ?? null,
              cashOut: Number(b.cashOut),
              cashIn: b.cashIn != null ? Number(b.cashIn) : null,
            }));
          }

          return {
            schedule: {
              scheduleId: sched.id,

              shiftId,
              shift: shiftCode as Shift,
              shiftCode,
              shiftLabel,
              shiftDescription,

              startTime: startTime ?? null,
              endTime: endTime ?? null,
              accent: accent ?? null,
              icon: icon ?? null,
              sortOrder: shiftSortOrder,

              storeId: sched.storeId,
              date: sched.date.toISOString(),

              /**
               * Frontend should use this to render available break buttons.
               * Example:
               * - morning: Lunch
               * - evening: Dinner
               * - full_day: Full Day Lunch, Full Day Dinner
               * - custom shift: whatever is saved in shifts.breaks
               */
              availableBreaks: configuredBreaks,
            },

            attendance: att
              ? {
                  attendanceId: att.id,
                  scheduleId: sched.id,
                  status: att.status,

                  shift: shiftCode as Shift,
                  shiftCode,
                  shiftLabel,

                  checkInTime: att.checkInTime?.toISOString() ?? null,
                  checkOutTime: att.checkOutTime?.toISOString() ?? null,
                  onBreak: att.onBreak,
                  notes: att.notes,
                  breaks,
                }
              : null,
          };
        },
      ),
    );

    return NextResponse.json({
      success: true,
      shifts: shiftSlots,
    });
  } catch (err) {
    console.error('[GET /api/employee/attendance]', err);

    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}

// ─── POST /api/employee/attendance ────────────────────────────────────────────
//
// Body:
//   { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift: string }
//
// startbreak:
//   { action: 'startbreak', shift: string, breakType?: string, cashOut: number }
//
// endbreak:
//   { action: 'endbreak', shift: string, cashIn: number }

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const user = session.user as any;
    const userId = user.id as string;
    const homeStoreId =
      user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || Number.isNaN(homeStoreId)) {
      return NextResponse.json(
        { success: false, error: 'No home store assigned.' },
        { status: 400 },
      );
    }

    const body = await req.json();

    const {
      action,
      shift,
      breakType: rawBreakType,
      cashOut: rawCashOut,
      cashIn: rawCashIn,
    } = body as {
      action?: string;
      shift?: string;
      breakType?: string;
      cashOut?: number;
      cashIn?: number;
    };

    if (!action || !shift) {
      return NextResponse.json(
        { success: false, error: 'action and shift are required.' },
        { status: 400 },
      );
    }

    /**
     * Important:
     * Instead of hardcoding valid shifts, validate against today's actual
     * employee schedule + active shifts table.
     */
    const scheduleRow = await getTodayScheduleForShift({
      userId,
      storeId: homeStoreId,
      shiftCode: shift,
    });

    if (!scheduleRow) {
      return NextResponse.json(
        {
          success: false,
          error: `No active "${shift}" schedule found for this employee today.`,
        },
        { status: 400 },
      );
    }

    const typedShift = scheduleRow.shift.code as Shift;
    const configuredBreaks = getShiftBreaks(
      scheduleRow.shift.breaks,
      scheduleRow.shift.code,
    );

    let result;

    switch (action) {
      case 'checkin': {
        result = await employeeCheckIn(userId, homeStoreId, typedShift);
        break;
      }

      case 'checkout': {
        result = await employeeCheckOut(userId, homeStoreId, typedShift);
        break;
      }

      case 'startbreak': {
        if (
          rawCashOut == null ||
          Number.isNaN(Number(rawCashOut)) ||
          Number(rawCashOut) < 0
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                'cashOut (amount taken out) is required and must be a non-negative number.',
            },
            { status: 400 },
          );
        }

        const cashOut = Number(rawCashOut);

        if (!configuredBreaks.length) {
          return NextResponse.json(
            {
              success: false,
              error: `Shift "${scheduleRow.shift.label}" does not have any configured break.`,
            },
            { status: 400 },
          );
        }

        let resolvedBreakType: BreakType | null = null;

        if (rawBreakType) {
          if (!isValidBreakType(rawBreakType)) {
            return NextResponse.json(
              {
                success: false,
                error: `Invalid breakType "${rawBreakType}".`,
              },
              { status: 400 },
            );
          }

          const allowedForShift = configuredBreaks.some(
            (b) => b.type === rawBreakType,
          );

          if (!allowedForShift) {
            return NextResponse.json(
              {
                success: false,
                error: `Break type "${rawBreakType}" is not allowed for shift "${scheduleRow.shift.label}".`,
              },
              { status: 400 },
            );
          }

          resolvedBreakType = rawBreakType;
        } else if (configuredBreaks.length === 1) {
          /**
           * If the shift has only one break configured, the frontend does not
           * need to send breakType.
           */
          resolvedBreakType = configuredBreaks[0].type;
        } else {
          return NextResponse.json(
            {
              success: false,
              error: `Shift "${scheduleRow.shift.label}" has multiple breaks. Please provide breakType.`,
              availableBreaks: configuredBreaks,
            },
            { status: 400 },
          );
        }

        result = await startBreak(
          userId,
          homeStoreId,
          typedShift,
          resolvedBreakType,
          cashOut,
        );

        break;
      }

      case 'endbreak': {
        if (
          rawCashIn == null ||
          Number.isNaN(Number(rawCashIn)) ||
          Number(rawCashIn) < 0
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                'cashIn (amount brought back) is required and must be a non-negative number.',
            },
            { status: 400 },
          );
        }

        const cashIn = Number(rawCashIn);

        const today = todayInStoreTimezone();
        const dayStart = startOfDay(today);
        const dayEnd = endOfDay(today);

        const [existing] = await db
          .select({
            id: attendance.id,
          })
          .from(attendance)
          .innerJoin(schedules, eq(attendance.scheduleId, schedules.id))
          .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
          .where(
            and(
              eq(attendance.userId, userId),
              eq(attendance.storeId, homeStoreId),
              eq(shifts.code, typedShift),
              eq(attendance.onBreak, true),
              gte(schedules.date, dayStart),
              lte(schedules.date, dayEnd),
            ),
          )
          .limit(1);

        if (!existing) {
          return NextResponse.json(
            { success: false, error: 'No active break found.' },
            { status: 400 },
          );
        }

        result = await endBreak(userId, homeStoreId, existing.id, cashIn);
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action "${action}".` },
          { status: 400 },
        );
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (err) {
    console.error('[POST /api/employee/attendance]', err);

    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}