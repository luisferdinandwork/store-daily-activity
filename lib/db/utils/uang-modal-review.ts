// lib/db/utils/uang-modal-review.ts
//
// Data behind Finance's Uang Modal Review (one day, every store that opened)
// and Uang Modal Report (one month, every store), plus bulk verification.
//
// Day buckets are midnight of the calendar day in the server's zone (UTC on
// prod), so dates come in as "YYYY-MM-DD" and are matched as a [start, end)
// range — see dayBounds in lib/finance/dates.ts.

import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  areas,
  cekUangModalDenominations,
  cekUangModalTasks,
  schedules,
  stores,
  users,
  type CekUangModalTask,
} from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import { OPENING_SHIFT_CODES } from '@/lib/shift-tasks';
import {
  UANG_MODAL_MAX_TOTAL,
  dayBounds,
  dayKey,
  monthBounds,
  storeCodeOf,
  type UangModalDenomination,
  type UangModalMonthRow,
  type UangModalRow,
} from '@/lib/uang-modal-review';

const toInt = (v: string | number | null | undefined): number =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Math.round(Number(v));

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

const byStoreNo = (a: { storeNo: string }, b: { storeNo: string }) =>
  a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true });

/**
 * A store can have more than one task row a day (the unique key includes the
 * shift). Prefer the submitted one, then the most recently touched.
 */
function pickTask(tasks: CekUangModalTask[]): CekUangModalTask {
  return [...tasks].sort((a, b) => {
    const done = Number(b.status === 'completed') - Number(a.status === 'completed');
    return done || b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

// ─── Daily review ────────────────────────────────────────────────────────────

/**
 * One row per store that has an opening-shift schedule on `dateStr` — plus any
 * store with a task that day, so a submission is never hidden just because its
 * schedule was edited afterwards.
 */
export async function getUangModalDay(dateStr: string): Promise<UangModalRow[]> {
  const bounds = dayBounds(dateStr);
  if (!bounds) throw new Error(`Invalid date "${dateStr}".`);
  const { start, end } = bounds;

  const [scheduleRows, taskRows] = await Promise.all([
    db
      .select({ userId: schedules.userId, storeId: schedules.storeId })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      // Prep (ready_to_open) / closed stores aren't expected to report.
      .innerJoin(stores, eq(stores.id, schedules.storeId))
      .where(and(
        eq(stores.status, 'active'),
        gte(schedules.date, start),
        lt(schedules.date, end),
        eq(schedules.isHoliday, false),
        inArray(shifts.code, [...OPENING_SHIFT_CODES]),
      )),
    db.select().from(cekUangModalTasks).where(and(gte(cekUangModalTasks.date, start), lt(cekUangModalTasks.date, end))),
  ]);

  const storeIds = [...new Set([...scheduleRows.map((r) => r.storeId), ...taskRows.map((t) => t.storeId)])];
  if (storeIds.length === 0) return [];

  const tasksByStore = new Map<number, CekUangModalTask[]>();
  for (const t of taskRows) tasksByStore.set(t.storeId, [...(tasksByStore.get(t.storeId) ?? []), t]);
  const taskByStore = new Map([...tasksByStore].map(([id, list]) => [id, pickTask(list)]));

  const taskIds = [...taskByStore.values()].map((t) => t.id);
  const userIds = new Set<string>([...scheduleRows.map((r) => r.userId)]);
  for (const t of taskByStore.values()) {
    userIds.add(t.userId);
    if (t.verifiedBy) userIds.add(t.verifiedBy);
  }

  const [storeRows, userRows, denomRows] = await Promise.all([
    db
      .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaName: areas.name })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(inArray(stores.id, storeIds)),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])),
    taskIds.length
      ? db.select().from(cekUangModalDenominations).where(inArray(cekUangModalDenominations.taskId, taskIds))
      : Promise.resolve([]),
  ]);

  const storeMap = new Map(storeRows.map((s) => [s.id, s]));
  const nameOf = new Map(userRows.map((u) => [u.id, u.name]));
  const name = (id: string | null | undefined) => (id ? nameOf.get(id) ?? id : null);

  const denomsByTask = new Map<number, UangModalDenomination[]>();
  for (const d of denomRows) {
    if (d.quantity <= 0) continue;
    const list = denomsByTask.get(d.taskId) ?? [];
    list.push({ value: d.denominationValue, quantity: d.quantity, amount: toInt(d.amount) });
    denomsByTask.set(d.taskId, list);
  }

  const staffByStore = new Map<number, { userId: string; name: string }[]>();
  for (const r of scheduleRows) {
    const list = staffByStore.get(r.storeId) ?? [];
    if (!list.some((s) => s.userId === r.userId)) list.push({ userId: r.userId, name: name(r.userId) ?? r.userId });
    staffByStore.set(r.storeId, list);
  }

  const rows = storeIds.flatMap((storeId): UangModalRow[] => {
    const store = storeMap.get(storeId);
    if (!store) return [];
    const task = taskByStore.get(storeId);

    return [{
      storeId,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      code: storeCodeOf(store.storeNo),

      taskId: task?.id ?? null,
      // The shared task enum also has 'on_hold' (never used for uang modal) — treat as unresolved.
      status: !task ? 'no_data' : task.status === 'on_hold' ? 'pending' : task.status,

      total: task ? toInt(task.totalAmount) : null,
      max: task ? toInt(task.maxAmount) : UANG_MODAL_MAX_TOTAL,
      denominations: (task ? denomsByTask.get(task.id) ?? [] : []).sort((a, b) => b.value - a.value),

      notes: task?.notes ?? null,
      submittedBy: name(task?.userId),
      completedAt: iso(task?.completedAt),

      verifiedBy: name(task?.verifiedBy),
      verifiedAt: iso(task?.verifiedAt),
      canVerify: task?.status === 'completed' && !task.verifiedAt,

      scheduledStaff: staffByStore.get(storeId) ?? [],
    }];
  });

  return rows.sort(byStoreNo);
}

// ─── Monthly report ──────────────────────────────────────────────────────────

/**
 * One row per store for `month` (YYYY-MM). `todayStr` is the Jakarta calendar
 * date — a work day only counts as missed once it is over.
 */
export async function getUangModalMonth(month: string, todayStr: string): Promise<UangModalMonthRow[]> {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error(`Invalid month "${month}".`);
  const { start, end } = bounds;

  const storeRows = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaName: areas.name })
    .from(stores)
    .innerJoin(areas, eq(areas.id, stores.areaId));
  if (storeRows.length === 0) return [];

  const [workRows, taskRows] = await Promise.all([
    db
      .selectDistinct({ storeId: schedules.storeId, date: schedules.date })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      // Prep (ready_to_open) / closed stores aren't expected to report.
      .innerJoin(stores, eq(stores.id, schedules.storeId))
      .where(and(
        eq(stores.status, 'active'),
        gte(schedules.date, start),
        lt(schedules.date, end),
        eq(schedules.isHoliday, false),
        inArray(shifts.code, [...OPENING_SHIFT_CODES]),
      )),
    db
      .select()
      .from(cekUangModalTasks)
      .where(and(gte(cekUangModalTasks.date, start), lt(cekUangModalTasks.date, end), eq(cekUangModalTasks.status, 'completed')))
      .orderBy(desc(cekUangModalTasks.date)),
  ]);

  const workDates = new Map<number, Set<string>>();
  for (const r of workRows) {
    const set = workDates.get(r.storeId) ?? new Set<string>();
    set.add(dayKey(r.date));
    workDates.set(r.storeId, set);
  }

  // One completed float per store per calendar day (see pickTask).
  const doneByStoreDay = new Map<number, Map<string, CekUangModalTask>>();
  for (const t of taskRows) {
    const days = doneByStoreDay.get(t.storeId) ?? new Map<string, CekUangModalTask>();
    const key = dayKey(t.date);
    const prev = days.get(key);
    days.set(key, prev ? pickTask([prev, t]) : t);
    doneByStoreDay.set(t.storeId, days);
  }

  return storeRows
    .map((s): UangModalMonthRow => {
      const work = workDates.get(s.id) ?? new Set<string>();
      const done = doneByStoreDay.get(s.id) ?? new Map<string, CekUangModalTask>();

      // Work days that count so far, newest first (also drives the streak).
      const elapsed = [...work].filter((d) => d <= todayStr).sort().reverse();

      let fullDays = 0, shortDays = 0, emptyDays = 0, missedDays = 0;
      let totalCounted = 0, totalShortfall = 0, unverified = 0;
      let last: string | null = null;

      for (const t of done.values()) {
        const total = toInt(t.totalAmount);
        const max = toInt(t.maxAmount) || UANG_MODAL_MAX_TOTAL;
        totalCounted += total;
        totalShortfall += Math.max(0, max - total);
        if (total <= 0) emptyDays += 1;
        else if (total < max) shortDays += 1;
        else fullDays += 1;
        if (!t.verifiedAt) unverified += 1;
        const key = dayKey(t.date);
        if (!last || key > last) last = key;
      }

      for (const d of elapsed) if (d < todayStr && !done.has(d)) missedDays += 1;

      // Streak of most recent work days that were not full. Today counts only
      // once it has been submitted — an unfinished today is still open.
      let notFullStreak = 0;
      for (const d of elapsed) {
        const t = done.get(d);
        if (!t && d === todayStr) continue;
        const full = t ? toInt(t.totalAmount) >= (toInt(t.maxAmount) || UANG_MODAL_MAX_TOTAL) : false;
        if (full) break;
        notFullStreak += 1;
      }

      const submitted = fullDays + shortDays + emptyDays;
      const cap = totalCounted + totalShortfall;

      return {
        storeId: s.id,
        storeNo: s.storeNo,
        storeName: s.name,
        areaName: s.areaName,
        code: storeCodeOf(s.storeNo),

        workDays: elapsed.length,
        fullDays,
        shortDays,
        emptyDays,
        missedDays,

        totalCounted,
        totalShortfall,
        avgCounted: submitted > 0 ? Math.round(totalCounted / submitted) : 0,
        avgFillPct: cap > 0 ? Math.round((totalCounted / cap) * 100) : 0,
        notFullStreak,

        unverified,
        lastSubmittedDate: last,
      };
    })
    .sort(byStoreNo);
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * Marks completed, not-yet-verified uang modal checks as verified. The
 * condition is in the UPDATE itself, so two reviewers racing can't both claim
 * the same task. Returns the ids that were actually verified.
 */
export async function verifyUangModalTasks(taskIds: number[], verifierId: string): Promise<number[]> {
  if (taskIds.length === 0) return [];
  const now = new Date();

  const rows = await db
    .update(cekUangModalTasks)
    .set({ verifiedBy: verifierId, verifiedAt: now, updatedAt: now })
    .where(and(
      inArray(cekUangModalTasks.id, taskIds),
      eq(cekUangModalTasks.status, 'completed'),
      isNull(cekUangModalTasks.verifiedAt),
    ))
    .returning({ id: cekUangModalTasks.id });

  return rows.map((r) => r.id);
}
