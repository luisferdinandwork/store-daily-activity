// app/api/employee/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { asc, and, eq, gte, lte, inArray } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  schedules,
  attendance,
  breakSessions,
  shifts,
  users,
} from '@/lib/db/schema';
import {
  getStoreCashCountsForDate,
  listCoScheduledEmployees,
  resolveCashCountScheduleId,
  submitStoreCashCount,
} from '@/lib/db/utils/store-cash-count';
import {
  CASH_COUNT_SESSIONS,
  cashCountSessionLabels,
  isCashCountSession,
  missingCashCountSessionsForShift,
} from '@/lib/cash-count-sessions';
import { baseShiftCode } from '@/lib/shift-tasks';
import { assertInGeofence, getStoreGeofence } from '@/lib/db/utils/geofence';
import { parseGeoPoint } from '@/lib/geo';
import { getStoreStatus } from '@/lib/db/utils/store-status';
import { isStoreOperational, storeInactiveMessage } from '@/lib/store-status';

import {
  employeeCheckIn,
  employeeCheckOut,
  startBreak,
  endBreak,
  todayInStoreTimezone,
  autoCheckoutOverdueAttendance,
  startOfDay,
  endOfDay,
} from '@/lib/schedule-utils';

import type { Shift, BreakType } from '@/lib/schedule-utils';

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
function fallbackBreaksForShiftCode(code: string): ShiftBreakDef[] {
  const shiftCode = baseShiftCode(code);
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

// ─── Cashier cash-count payload ───────────────────────────────────────────────
//
// "Count the cashier cash + selfie with a co-scheduled colleague" step, once
// per store/day per SOP session (Pagi, Siang 1, Siang 2, Sore, Malam). Anyone
// working today can record a session; all five are mandatory, enforced at
// checkout (see missingCashCountSessionsForShift).
async function buildCashCountPayload(
  userId: string,
  storeId: number,
  today: Date,
  todayRows: { shiftCode: string }[],
) {
  const canSubmit = todayRows.length > 0;

  const counted = await getStoreCashCountsForDate(storeId, today);

  const nameIds = [...new Set(counted.flatMap((c) => [c.countedByUserId, c.witnessUserId]))];
  const nameById = new Map(
    nameIds.length
      ? (
          await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, nameIds))
        ).map((n) => [n.id, n.name])
      : [],
  );

  const sessions = CASH_COUNT_SESSIONS.map((session) => {
    const row = counted.find((c) => c.session === session);
    return {
      session,
      record: row
        ? {
            totalAmount: Number(row.totalAmount),
            countedByName: nameById.get(row.countedByUserId) ?? null,
            witnessName: nameById.get(row.witnessUserId) ?? null,
            selfiePhoto: row.selfiePhoto,
            completedAt: row.completedAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  const coScheduledEmployees =
    canSubmit && sessions.some((s) => !s.record)
      ? await listCoScheduledEmployees(userId, storeId, today)
      : [];

  return { canSubmit, sessions, coScheduledEmployees };
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

    const user = session.user as { id: string; homeStoreId?: string | number };
    const userId = user.id;
    const homeStoreId =
      user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || Number.isNaN(homeStoreId)) {
      return NextResponse.json({ success: true, shifts: [] });
    }

    // Ready-to-open / closed stores record no attendance — hide the shifts and
    // tell the page why instead of showing a check-in button that would fail.
    const storeStatus = await getStoreStatus(homeStoreId);
    if (storeStatus && !isStoreOperational(storeStatus)) {
      return NextResponse.json({
        success: true,
        shifts: [],
        storeStatus,
        storeInactiveMessage: storeInactiveMessage(storeStatus),
      });
    }

    // Close out any of this employee's own shifts left open past their end
    // time before reading today's rows, so the response is always current.
    await autoCheckoutOverdueAttendance({ userId });

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

    const [cashCount, geofence] = await Promise.all([
      buildCashCountPayload(userId, homeStoreId, today, rows),
      getStoreGeofence(homeStoreId),
    ]);

    return NextResponse.json({
      success: true,
      shifts: shiftSlots,
      cashCount,
      geofence,
    });
  } catch (err) {
    console.error('[GET /api/employee/attendance]', err);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ─── POST /api/employee/attendance ────────────────────────────────────────────
//
// Body:
//   { action: 'checkin'|'checkout'|'startbreak'|'endbreak', shift: string }
//
// checkin:
//   { action: 'checkin', shift: string, lat: number, lng: number }
//   Location is mandatory and must be inside the home store's geofence.
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

    const user = session.user as { id: string; homeStoreId?: string | number };
    const userId = user.id;
    const homeStoreId =
      user.homeStoreId != null ? Number(user.homeStoreId) : null;

    if (!homeStoreId || Number.isNaN(homeStoreId)) {
      return NextResponse.json(
        { success: false, error: 'No home store assigned.' },
        { status: 400 },
      );
    }

    const storeStatus = await getStoreStatus(homeStoreId);
    if (storeStatus && !isStoreOperational(storeStatus)) {
      return NextResponse.json(
        { success: false, error: storeInactiveMessage(storeStatus) },
        { status: 403 },
      );
    }

    const body = await req.json();

    const {
      action,
      shift,
      breakType: rawBreakType,
      cashOut: rawCashOut,
      cashIn: rawCashIn,
      session: rawSession,
      totalAmount: rawTotalAmount,
      witnessUserId: rawWitnessUserId,
      selfiePhoto: rawSelfiePhoto,
      notes: rawNotes,
      lat: rawLat,
      lng: rawLng,
      accuracy: rawAccuracy,
    } = body as {
      action?: string;
      shift?: string;
      breakType?: string;
      cashOut?: number;
      cashIn?: number;
      session?: string;
      totalAmount?: number;
      witnessUserId?: string;
      selfiePhoto?: string;
      notes?: string;
      lat?: unknown;
      lng?: unknown;
      accuracy?: unknown;
    };

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'action is required.' },
        { status: 400 },
      );
    }

    // ── Cashier cash-count + buddy selfie ─────────────────────────────────────
    // Not shift-specific — record one shared store-level count for the SOP
    // session the employee picked, against their own schedule for today.
    if (action === 'cashcount') {
      if (!isCashCountSession(rawSession)) {
        return NextResponse.json(
          { success: false, error: 'Pilih waktu hitung kas terlebih dahulu.' },
          { status: 400 },
        );
      }

      const actorScheduleId = await resolveCashCountScheduleId(
        userId,
        homeStoreId,
        todayInStoreTimezone(),
      );

      if (!actorScheduleId) {
        return NextResponse.json(
          {
            success: false,
            error: 'Kamu tidak punya jadwal di toko ini hari ini.',
          },
          { status: 400 },
        );
      }

      const result = await submitStoreCashCount({
        userId,
        scheduleId: actorScheduleId,
        storeId: homeStoreId,
        session: rawSession,
        totalAmount: Number(rawTotalAmount),
        witnessUserId: String(rawWitnessUserId ?? ''),
        selfiePhoto: String(rawSelfiePhoto ?? ''),
        notes: rawNotes,
      });

      if (!result.success) {
        return NextResponse.json(result, { status: 400 });
      }
      return NextResponse.json({ success: true, cashCount: result.data });
    }

    if (!shift) {
      return NextResponse.json(
        { success: false, error: 'shift is required.' },
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
        // Check-in must happen at the store: a location fix is required, and
        // it has to fall inside the home store's geofence.
        const geo = parseGeoPoint(rawLat, rawLng, rawAccuracy);
        if (!geo) {
          return NextResponse.json(
            {
              success: false,
              error: 'Lokasi wajib aktif untuk absen masuk. Izinkan akses lokasi lalu coba lagi.',
            },
            { status: 400 },
          );
        }

        const geoErr = await assertInGeofence(homeStoreId, geo);
        if (geoErr) {
          return NextResponse.json(
            { success: false, error: geoErr },
            { status: 400 },
          );
        }

        result = await employeeCheckIn(userId, homeStoreId, typedShift);
        break;
      }

      case 'checkout': {
        // All five cash-count sessions are mandatory: an opening shift can't
        // check out until sessions 1–4 (through "shift pagi pulang") are on
        // record, a closing shift until all five are.
        const counted = await getStoreCashCountsForDate(homeStoreId, todayInStoreTimezone());
        const missing = missingCashCountSessionsForShift(
          typedShift,
          counted.map((c) => c.session),
        );
        if (missing.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error:
                `Hitung kas kasir sesi ${cashCountSessionLabels(missing)} belum diisi. ` +
                'Selesaikan dulu sebelum absen pulang.',
            },
            { status: 400 },
          );
        }

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
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}