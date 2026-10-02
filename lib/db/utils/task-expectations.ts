// lib/db/utils/task-expectations.ts
//
// Which task "slots" a store's schedule says should exist on a day.
//
// Task rows are created lazily — only when an employee opens their task list
// (app/api/employee/tasks GET → getOrCreate*ForSchedule). A shift whose staff
// never opened the app has no rows at all, so progress views that only read
// rows dropped that whole shift: some stores showed every scheduled shift,
// others only the shifts somebody happened to open.
//
// This derives the expected slots from schedules + the shift_tasks config,
// keyed exactly the way the getOrCreate helpers key their rows, so progress
// views can count (and show) a not-started placeholder for every slot that has
// no row yet. Read-only on purpose: creating rows from an Ops read would start
// e.g. a setoran carry-over chain nobody worked on.

import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { attendance, schedules, shiftTasks, stores, taskDefinitions } from '@/lib/db/schema';
import { isLeaveAttendanceStatus } from '@/lib/attendance-status';
import { jakartaDateKey, jakartaDaysRange, jakartaTodayKey } from '@/lib/day-bucket';
import { baseShiftCode, isClosingShift, isOpeningShift, isTaskType, type TaskType } from '@/lib/shift-tasks';
import { getShiftCodeById } from '@/lib/db/utils/shift-lookup';

export interface ExpectedTaskSlot {
  key: string;
  storeId: number;
  /** Jakarta day, "YYYY-MM-DD". */
  date: string;
  type: TaskType;
  /** Base shift code the slot reports under (JKP → morning/evening). */
  shift: string;
  /** First schedule that expects the slot. */
  scheduleId: number;
  /** Every employee scheduled for it (one for grooming). */
  userIds: string[];
}

// One shared row per store/day, created by any opening (or closing) schedule.
const OPENING_STORE_TYPES = new Set<TaskType>([
  'store_opening', 'setoran', 'store_front', 'cek_bin', 'vm_checklist', 'marketing_check',
]);
// Always written with the morning shift id, even by a full_day schedule.
const MORNING_ROW_TYPES = new Set<TaskType>(['store_opening', 'setoran']);

/**
 * Slot key of a task row (or an expected slot) — mirrors how the getOrCreate
 * helpers dedupe rows. null = not tracked as a daily slot (serah terima is a
 * rolling board, not a per-day row).
 */
export function taskSlotKey(type: string, shiftCode: string | null, userId: string): string | null {
  if (!isTaskType(type)) return null;
  if (OPENING_STORE_TYPES.has(type) || type === 'store_closing') return type;
  if (type === 'briefing' || type === 'cek_uang_modal') return `${type}:${baseShiftCode(shiftCode)}`;
  if (type === 'grooming') return `grooming:${userId}`;
  return null;
}

/** `${storeId}::${YYYY-MM-DD}` — the bucket key of the map below. */
export function storeDayKey(storeId: number, dateKey: string): string {
  return `${storeId}::${dateKey}`;
}

/**
 * Expected slots per store/day for Jakarta days `fromKey`..`toKey` (inclusive),
 * keyed by storeDayKey(). Days after today are skipped — those shifts haven't
 * happened yet. Only active stores, working (non-holiday) schedules, and
 * employees not on justified leave (D / C / STD / SD / excused) count.
 */
export async function getExpectedTaskSlots(
  storeIds: number[],
  fromKey: string,
  toKey: string,
): Promise<Map<string, ExpectedTaskSlot[]>> {
  const out = new Map<string, ExpectedTaskSlot[]>();
  const todayKey = jakartaTodayKey();
  const lastKey = toKey > todayKey ? todayKey : toKey;
  if (!storeIds.length || !fromKey || !lastKey || fromKey > lastKey) return out;

  const { start, end } = jakartaDaysRange(fromKey, lastKey);

  const [scheduleRows, configRows, shiftCodeById] = await Promise.all([
    db
      .select({
        id: schedules.id,
        userId: schedules.userId,
        storeId: schedules.storeId,
        shiftId: schedules.shiftId,
        date: schedules.date,
        attendanceStatus: attendance.status,
      })
      .from(schedules)
      .innerJoin(stores, eq(stores.id, schedules.storeId))
      .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
      .where(and(
        inArray(schedules.storeId, storeIds),
        eq(schedules.isHoliday, false),
        eq(stores.status, 'active'),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ))
      .orderBy(schedules.id),
    db
      .select({ shiftId: shiftTasks.shiftId, code: taskDefinitions.code })
      .from(shiftTasks)
      .innerJoin(taskDefinitions, eq(taskDefinitions.id, shiftTasks.taskDefinitionId))
      .where(and(eq(shiftTasks.isActive, true), eq(taskDefinitions.isActive, true))),
    getShiftCodeById(),
  ]);

  const typesByShiftId = new Map<number, TaskType[]>();
  for (const row of configRows) {
    if (!isTaskType(row.code)) continue;
    const list = typesByShiftId.get(row.shiftId) ?? [];
    list.push(row.code);
    typesByShiftId.set(row.shiftId, list);
  }

  const slotsByBucket = new Map<string, Map<string, ExpectedTaskSlot>>();

  for (const s of scheduleRows) {
    if (s.attendanceStatus === 'excused' || isLeaveAttendanceStatus(s.attendanceStatus)) continue;

    const code = shiftCodeById.get(s.shiftId);
    if (!code) continue;
    const base = baseShiftCode(code);

    const date = jakartaDateKey(s.date);
    const bucketKey = storeDayKey(s.storeId, date);
    const slots = slotsByBucket.get(bucketKey) ?? new Map<string, ExpectedTaskSlot>();
    slotsByBucket.set(bucketKey, slots);

    const expect = (type: TaskType, shift: string) => {
      const key = taskSlotKey(type, shift, s.userId);
      if (!key) return;
      const slot = slots.get(key);
      if (!slot) {
        slots.set(key, { key, storeId: s.storeId, date, type, shift, scheduleId: s.id, userIds: [s.userId] });
        return;
      }
      if (!slot.userIds.includes(s.userId)) slot.userIds.push(s.userId);
      // A store-level row made by a morning/evening schedule reports under that
      // shift, so prefer it over full_day when both are on the roster.
      if (slot.shift === 'full_day' && shift !== 'full_day') slot.shift = shift;
    };

    for (const type of typesByShiftId.get(s.shiftId) ?? []) {
      if (OPENING_STORE_TYPES.has(type)) {
        if (isOpeningShift(code)) expect(type, MORNING_ROW_TYPES.has(type) ? 'morning' : base);
      } else if (type === 'store_closing') {
        if (isClosingShift(code)) expect(type, base);
      } else if (type === 'briefing') {
        // full_day works both halves → both the morning and evening briefing.
        for (const target of base === 'full_day' ? ['morning', 'evening'] : [base]) expect(type, target);
      } else if (type === 'cek_uang_modal') {
        // Opening float only: full_day checks the morning one, evening has none.
        if (base !== 'evening') expect(type, base === 'full_day' ? 'morning' : base);
      } else if (type === 'grooming') {
        expect(type, base);
      }
    }
  }

  for (const [bucketKey, slots] of slotsByBucket) {
    if (slots.size) out.set(bucketKey, [...slots.values()]);
  }
  return out;
}

/** Expected slots that no existing row covers. */
export function missingTaskSlots(
  expected: ExpectedTaskSlot[] | undefined,
  rows: Array<{ type: string; shift: string | null; userId: string }>,
): ExpectedTaskSlot[] {
  if (!expected?.length) return [];
  const covered = new Set<string>();
  for (const row of rows) {
    const key = taskSlotKey(row.type, row.shift, row.userId);
    if (key) covered.add(key);
  }
  return expected.filter((slot) => !covered.has(slot.key));
}
