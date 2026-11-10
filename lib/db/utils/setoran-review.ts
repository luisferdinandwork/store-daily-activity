// lib/db/utils/setoran-review.ts
//
// Data behind Finance's Setoran Review (one day, every store that opened) and
// Setoran Report (one month, every store), plus bulk verification.
//
// Day buckets are midnight of the calendar day in the server's zone (UTC on
// prod), so dates come in as "YYYY-MM-DD" and are matched as a [start, end)
// range — see dayBounds in lib/setoran-review.ts.

import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  areas,
  schedules,
  setoranMoneyStorage,
  setoranTasks,
  stores,
  users,
} from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import { getLatestCorrectionsByTask } from '@/lib/db/utils/setoran-correction';
import { OPENING_SHIFT_CODES } from '@/lib/shift-tasks';
import {
  dayBounds,
  dayKey,
  storeCodeOf,
  type SetoranMonthRow,
  type SetoranStoreRow,
} from '@/lib/setoran-review';

const toInt = (v: string | number | null | undefined): number =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Math.round(Number(v));

const toIntOrNull = (v: string | number | null | undefined): number | null =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

const byStoreNo = (a: { storeNo: string }, b: { storeNo: string }) =>
  a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true });

/**
 * Unpaid balance from each store's latest ledger row strictly before `before`
 * — what carries into that day. One query for every store.
 */
async function priorUnpaidByStore(storeIds: number[], before: Date): Promise<Map<number, number>> {
  if (storeIds.length === 0) return new Map();

  const rows = await db
    .selectDistinctOn([setoranMoneyStorage.storeId], {
      storeId: setoranMoneyStorage.storeId,
      unpaid: setoranMoneyStorage.unpaidAmount,
    })
    .from(setoranMoneyStorage)
    .where(and(inArray(setoranMoneyStorage.storeId, storeIds), lt(setoranMoneyStorage.date, before)))
    .orderBy(setoranMoneyStorage.storeId, desc(setoranMoneyStorage.date));

  return new Map(rows.map((r) => [r.storeId, toInt(r.unpaid)]));
}

// ─── Daily review ────────────────────────────────────────────────────────────

/**
 * One row per store that has an opening-shift schedule on `dateStr` — plus any
 * store with a setoran task that day, so a submission is never hidden just
 * because its schedule was edited afterwards.
 */
export async function getSetoranDay(dateStr: string): Promise<SetoranStoreRow[]> {
  const bounds = dayBounds(dateStr);
  if (!bounds) throw new Error(`Invalid date "${dateStr}".`);
  const { start: dayStart, end: dayEnd } = bounds;

  const [scheduleRows, taskRows, storageRows] = await Promise.all([
    db
      .select({ userId: schedules.userId, storeId: schedules.storeId })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      // Prep (ready_to_open) / closed stores aren't expected to report.
      .innerJoin(stores, eq(stores.id, schedules.storeId))
      .where(and(
        eq(stores.status, 'active'),
        gte(schedules.date, dayStart),
        lt(schedules.date, dayEnd),
        inArray(shifts.code, [...OPENING_SHIFT_CODES]),
      )),
    db.select().from(setoranTasks).where(and(gte(setoranTasks.date, dayStart), lt(setoranTasks.date, dayEnd))),
    db
      .select()
      .from(setoranMoneyStorage)
      .where(and(gte(setoranMoneyStorage.date, dayStart), lt(setoranMoneyStorage.date, dayEnd))),
  ]);

  const storeIds = [...new Set([
    ...scheduleRows.map((r) => r.storeId),
    ...taskRows.map((t) => t.storeId),
  ])];
  if (storeIds.length === 0) return [];

  const taskByStore = new Map(taskRows.map((t) => [t.storeId, t]));
  const storageByStore = new Map(storageRows.map((s) => [s.storeId, s]));

  // Names: scheduled staff + everyone who touched a task.
  const userIds = new Set<string>(scheduleRows.map((r) => r.userId));
  for (const t of taskRows) {
    for (const id of [t.completedBy, t.verifiedBy, t.actualReceivedAmountBy, t.storedAmountBy]) {
      if (id) userIds.add(id);
    }
  }
  for (const s of storageRows) if (s.completedBy) userIds.add(s.completedBy);

  const [storeRows, userRows, priorMap, correctionByTask] = await Promise.all([
    db
      .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaName: areas.name })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(inArray(stores.id, storeIds)),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])),
    priorUnpaidByStore(storeIds, dayStart),
    getLatestCorrectionsByTask(taskRows.map((t) => t.id)),
  ]);

  const storeMap = new Map(storeRows.map((s) => [s.id, s]));
  const nameOf = new Map(userRows.map((u) => [u.id, u.name]));
  const name = (id: string | null | undefined) => (id ? nameOf.get(id) ?? id : null);

  const staffByStore = new Map<number, { userId: string; name: string }[]>();
  for (const r of scheduleRows) {
    const list = staffByStore.get(r.storeId) ?? [];
    if (!list.some((s) => s.userId === r.userId)) list.push({ userId: r.userId, name: name(r.userId) ?? r.userId });
    staffByStore.set(r.storeId, list);
  }

  const rows = storeIds.flatMap((storeId): SetoranStoreRow[] => {
    const store = storeMap.get(storeId);
    if (!store) return [];

    const task = taskByStore.get(storeId);
    const storage = storageByStore.get(storeId);

    // The ledger row is written atomically on submit, so it wins over the task's
    // draft columns. A store that hasn't submitted shows the live carry-in.
    const carryIn = storage ? toInt(storage.previousUnpaidAmount) : priorMap.get(storeId) ?? 0;
    const received = toIntOrNull(storage?.actualReceivedAmount ?? task?.expectedAmount);
    const required = storage
      ? toInt(storage.requiredStoreAmount)
      : received != null ? received + carryIn : null;
    const stored = toIntOrNull(storage?.storedAmount ?? task?.amount);
    const unpaid = storage
      ? toInt(storage.unpaidAmount)
      : required != null && stored != null ? Math.max(0, required - stored) : null;

    return [{
      storeId,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      code: storeCodeOf(store.storeNo),

      taskId: task?.id ?? null,
      // The shared task enum also has 'on_hold' (not used for setoran) — treat as unresolved.
      status: !task ? 'no_data' : task.status === 'on_hold' ? 'pending' : task.status,

      received,
      carryIn,
      required,
      stored,
      unpaid,
      isNoSetoran: Boolean(storage?.isNoSetoran ?? task?.isNoSetoran),

      resiPhoto: task?.resiPhoto ?? null,
      atmCardSelfiePhoto: task?.atmCardSelfiePhoto ?? null,
      cashierPhoto: task?.cashierPhoto ?? null,
      atmCardPhoto: task?.atmCardPhoto ?? null,

      submittedBy: name(task?.completedBy),
      submittedAt: iso(task?.completedAt),
      receivedBy: name(task?.actualReceivedAmountBy),
      receivedAt: iso(task?.actualReceivedAmountAt),
      storedBy: name(task?.storedAmountBy),
      storedAt: iso(task?.storedAmountAt),
      notes: task?.notes ?? null,

      verifiedBy: name(task?.verifiedBy),
      verifiedAt: iso(task?.verifiedAt),
      canVerify: task?.status === 'completed' && !task.verifiedAt,

      correction: task ? correctionByTask.get(task.id) ?? null : null,

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
export async function getSetoranMonth(month: string, todayStr: string): Promise<SetoranMonthRow[]> {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1); // exclusive

  const storeRows = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaName: areas.name })
    .from(stores)
    .innerJoin(areas, eq(areas.id, stores.areaId));
  if (storeRows.length === 0) return [];

  const [workRows, taskRows, ledgerRows, closingRows] = await Promise.all([
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
        inArray(shifts.code, [...OPENING_SHIFT_CODES]),
      )),
    db
      .select({
        id: setoranTasks.id,
        storeId: setoranTasks.storeId,
        date: setoranTasks.date,
        verifiedAt: setoranTasks.verifiedAt,
      })
      .from(setoranTasks)
      .where(and(gte(setoranTasks.date, start), lt(setoranTasks.date, end), eq(setoranTasks.status, 'completed'))),
    db
      .select({
        storeId: setoranMoneyStorage.storeId,
        date: setoranMoneyStorage.date,
        received: setoranMoneyStorage.actualReceivedAmount,
        stored: setoranMoneyStorage.storedAmount,
      })
      .from(setoranMoneyStorage)
      .where(and(gte(setoranMoneyStorage.date, start), lt(setoranMoneyStorage.date, end))),
    // Latest ledger row up to the end of the month — the balance still owed.
    db
      .selectDistinctOn([setoranMoneyStorage.storeId], {
        storeId: setoranMoneyStorage.storeId,
        unpaid: setoranMoneyStorage.unpaidAmount,
      })
      .from(setoranMoneyStorage)
      .where(lt(setoranMoneyStorage.date, end))
      .orderBy(setoranMoneyStorage.storeId, desc(setoranMoneyStorage.date)),
  ]);

  const workDates = new Map<number, Set<string>>();
  for (const r of workRows) {
    const set = workDates.get(r.storeId) ?? new Set<string>();
    set.add(dayKey(r.date));
    workDates.set(r.storeId, set);
  }

  const doneDates = new Map<number, Set<string>>();
  const unverified = new Map<number, number>();
  for (const t of taskRows) {
    const set = doneDates.get(t.storeId) ?? new Set<string>();
    set.add(dayKey(t.date));
    doneDates.set(t.storeId, set);
    if (!t.verifiedAt) unverified.set(t.storeId, (unverified.get(t.storeId) ?? 0) + 1);
  }

  const money = new Map<number, { received: number; stored: number; deposit: number; noDeposit: number; last: string | null }>();
  for (const l of ledgerRows) {
    const acc = money.get(l.storeId) ?? { received: 0, stored: 0, deposit: 0, noDeposit: 0, last: null };
    acc.received += toInt(l.received);
    acc.stored += toInt(l.stored);
    if (toInt(l.stored) > 0) acc.deposit += 1;
    else acc.noDeposit += 1;
    const key = dayKey(l.date);
    if (!acc.last || key > acc.last) acc.last = key;
    money.set(l.storeId, acc);
  }

  const closing = new Map(closingRows.map((r) => [r.storeId, toInt(r.unpaid)]));

  return storeRows
    .map((s): SetoranMonthRow => {
      const work = workDates.get(s.id) ?? new Set<string>();
      const done = doneDates.get(s.id) ?? new Set<string>();
      const acc = money.get(s.id);

      const elapsed = [...work].filter((d) => d <= todayStr);
      const missed = elapsed.filter((d) => d < todayStr && !done.has(d));

      return {
        storeId: s.id,
        storeNo: s.storeNo,
        storeName: s.name,
        areaName: s.areaName,
        code: storeCodeOf(s.storeNo),

        workDays: elapsed.length,
        depositDays: acc?.deposit ?? 0,
        noDepositDays: acc?.noDeposit ?? 0,
        missedDays: missed.length,

        totalReceived: acc?.received ?? 0,
        totalStored: acc?.stored ?? 0,
        closingUnpaid: closing.get(s.id) ?? 0,
        unverified: unverified.get(s.id) ?? 0,
        lastSubmittedDate: acc?.last ?? null,
      };
    })
    .sort(byStoreNo);
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * Marks completed, not-yet-verified tasks as verified. The condition is in the
 * UPDATE itself, so two reviewers racing can't both claim the same task.
 * Returns the ids that were actually verified.
 */
export async function verifySetoranTasks(taskIds: number[], verifierId: string): Promise<number[]> {
  if (taskIds.length === 0) return [];
  const now = new Date();

  const rows = await db
    .update(setoranTasks)
    .set({ verifiedBy: verifierId, verifiedAt: now, updatedAt: now })
    .where(and(
      inArray(setoranTasks.id, taskIds),
      eq(setoranTasks.status, 'completed'),
      isNull(setoranTasks.verifiedAt),
    ))
    .returning({ id: setoranTasks.id });

  return rows.map((r) => r.id);
}
