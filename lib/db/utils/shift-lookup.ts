// lib/db/utils/shift-lookup.ts
// Shared shift-id + actor-schedule resolution for tasks that are scoped to a
// specific shift (not just "morning") — e.g. briefing, serah terima.
import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { schedules, shifts } from '@/lib/db/schema';

type ShiftCode = 'morning' | 'evening' | 'full_day';

const shiftIdCache: Partial<Record<ShiftCode, number>> = {};

async function getShiftIdByCode(code: ShiftCode): Promise<number> {
  if (shiftIdCache[code] != null) return shiftIdCache[code]!;

  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, code))
    .limit(1);

  if (!row) throw new Error(`Shift with code "${code}" not found in shifts table.`);

  shiftIdCache[code] = row.id;
  return row.id;
}

export const getMorningShiftId  = () => getShiftIdByCode('morning');
export const getEveningShiftId  = () => getShiftIdByCode('evening');
export const getFullDayShiftId  = () => getShiftIdByCode('full_day');

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * A shift-scoped task row (briefing, serah terima, ...) is shared by every
 * employee working that shift at that store/day. The row's stored
 * `scheduleId` only reflects whoever happened to create it first — it must
 * NOT be used for the check-in gate. This resolves the CURRENT user's own
 * schedule for that store/day that actually matches the row's shift
 * (exact match, or a full_day schedule which covers both morning and
 * evening rows), so AccessGuard checks the right attendance record.
 *
 * Returns null if the user has no schedule at that store/day at all.
 */
export async function resolveActorScheduleId(
  userId: string,
  storeId: number,
  targetShiftId: number,
  date: Date,
): Promise<number | null> {
  const fullDayShiftId = await getFullDayShiftId();
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const candidates = await db
    .select({ id: schedules.id, shiftId: schedules.shiftId })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId, userId),
        eq(schedules.storeId, storeId),
        eq(schedules.isHoliday, false),
        gte(schedules.date, dayStart),
        lte(schedules.date, dayEnd),
      ),
    );

  const exact = candidates.find((c) => c.shiftId === targetShiftId);
  if (exact) return exact.id;

  const fullDay = candidates.find((c) => c.shiftId === fullDayShiftId);
  if (fullDay) return fullDay.id;

  return null;
}
