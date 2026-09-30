// lib/db/utils/setoran-correction.ts
//
// IT's "Koreksi Setoran": fix the amounts of one submitted setoran day — or fill
// in a day that has none — and recalculate the carry-over of every day after it.
//
// Why the tail is recalculated: the ledger (setoran_money_storage) is a running
// balance — a day's `unpaidAmount` is the next day's `previousUnpaidAmount`, and
// getPriorUnpaidForStore reads the latest earlier row. A wrong amount on one day
// therefore keeps inflating the sisa on every later day ("uang menumpuk"), so
// fixing just that row would change nothing going forward. Adding a missing day
// in the middle shifts the days after it the same way.
//
// Both setoran_money_storage (the ledger) and setoran_tasks (what the employee /
// Ops / Finance views read) are written, and the original figures are kept in
// setoran_corrections. Draft (not_started / in_progress) tasks after the day
// need nothing: refreshPendingCarryForward re-reads the balance on every open.
//
// A day IT fills in gets a task with no schedule (schedule_id is nullable for
// that): it must work for days with no schedule at all, and must not vanish when
// a schedule import/replace deletes tasks by schedule id.
//
// Unlike most utils this uses db.transaction(): the day and its whole tail must
// change together or not at all (lib/db is node-postgres, which supports it).

import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  schedules,
  setoranCorrections,
  setoranMoneyStorage,
  setoranTasks,
  stores,
  users,
} from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import { getMorningShiftId } from '@/lib/db/utils/setoran';
import { dayBounds, dayKey, shiftDate, todayJakarta } from '@/lib/finance/dates';
import { OPENING_SHIFT_CODES } from '@/lib/shift-tasks';
import {
  planSetoranCorrection,
  validateCorrectionReason,
  type CorrectableStore,
  type LedgerChainRow,
  type PlannedRow,
  type SetoranCorrectionEntry,
  type SetoranDayRow,
  type SetoranLedgerView,
} from '@/lib/setoran-correction';

export type CorrectionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: 400 | 404 | 409 };

const toInt = (v: string | number | null | undefined): number =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Math.round(Number(v));

const toIntOrNull = (v: string | number | null | undefined): number | null =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));

const money = (n: number): string => n.toFixed(2);

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

const byStoreNo = (a: { storeNo: string }, b: { storeNo: string }) =>
  a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true });

export const LEDGER_DEFAULT_DAYS = 45;
export const LEDGER_MAX_DAYS = 400;

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Active stores plus any store that already has a setoran (e.g. one closed since). */
export async function listCorrectableStores(): Promise<CorrectableStore[]> {
  const [active, withLedger] = await Promise.all([
    db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
      .from(stores)
      .where(eq(stores.status, 'active')),
    db
      .selectDistinct({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
      .from(setoranMoneyStorage)
      .innerJoin(stores, eq(stores.id, setoranMoneyStorage.storeId)),
  ]);

  const byId = new Map<number, CorrectableStore>();
  for (const s of [...active, ...withLedger]) byId.set(s.id, s);
  return [...byId.values()].sort(byStoreNo);
}

/**
 * Every calendar day of the last `days` days (through today, Jakarta), oldest
 * first — submitted, draft or nothing at all — with the running balance, plus
 * the store's correction history.
 */
export async function getSetoranLedger(
  storeId: number,
  days = LEDGER_DEFAULT_DAYS,
): Promise<SetoranLedgerView | null> {
  const [store] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return null;

  const today = todayJakarta();
  const firstDay = shiftDate(today, -(days - 1));
  const since = dayBounds(firstDay)?.start;
  if (!since) return null;

  const [ledgerRows, taskRows, scheduleRows, priorRows, correctionRows] = await Promise.all([
    db
      .select()
      .from(setoranMoneyStorage)
      .where(and(eq(setoranMoneyStorage.storeId, storeId), gte(setoranMoneyStorage.date, since)))
      .orderBy(asc(setoranMoneyStorage.date)),
    db
      .select()
      .from(setoranTasks)
      .where(and(eq(setoranTasks.storeId, storeId), gte(setoranTasks.date, since))),
    db
      .selectDistinct({ date: schedules.date })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      .where(and(
        eq(schedules.storeId, storeId),
        gte(schedules.date, since),
        inArray(shifts.code, [...OPENING_SHIFT_CODES]),
      )),
    // The balance coming into the window: the latest ledger row before it.
    db
      .select({ unpaid: setoranMoneyStorage.unpaidAmount })
      .from(setoranMoneyStorage)
      .where(and(eq(setoranMoneyStorage.storeId, storeId), lt(setoranMoneyStorage.date, since)))
      .orderBy(desc(setoranMoneyStorage.date))
      .limit(1),
    db
      .select()
      .from(setoranCorrections)
      .where(and(eq(setoranCorrections.storeId, storeId), gte(setoranCorrections.date, since)))
      .orderBy(desc(setoranCorrections.createdAt)),
  ]);

  const userIds = new Set<string>();
  for (const t of taskRows) {
    for (const id of [t.completedBy, t.verifiedBy]) if (id) userIds.add(id);
  }
  for (const c of correctionRows) userIds.add(c.correctedBy);

  const nameOf = new Map(
    userIds.size === 0
      ? []
      : (await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...userIds]))
        ).map((u) => [u.id, u.name] as const),
  );
  const name = (id: string | null | undefined) => (id ? nameOf.get(id) ?? id : null);

  const ledgerByDay = new Map(ledgerRows.map((l) => [dayKey(l.date), l]));
  const taskByDay = new Map(taskRows.map((t) => [dayKey(t.date), t]));
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const scheduledDays = new Set(scheduleRows.map((r) => dayKey(r.date)));

  const changeByTask = new Map<number, { count: number; latestKind: 'correct' | 'create' }>();
  // correctionRows is newest first — the first row seen per task is the latest.
  for (const c of correctionRows) {
    const cur = changeByTask.get(c.taskId);
    changeByTask.set(c.taskId, { count: (cur?.count ?? 0) + 1, latestKind: cur?.latestKind ?? c.kind });
  }

  let balance = toInt(priorRows[0]?.unpaid);
  const rows: SetoranDayRow[] = [];

  for (let day = firstDay; day <= today; day = shiftDate(day, 1)) {
    const ledger = ledgerByDay.get(day);
    const task = ledger ? taskById.get(ledger.taskId) ?? taskByDay.get(day) : taskByDay.get(day);
    const carryIn = ledger ? toInt(ledger.previousUnpaidAmount) : balance;
    const change = task ? changeByTask.get(task.id) : undefined;

    const base = {
      date: day,
      scheduled: scheduledDays.has(day),
      taskId: task?.id ?? null,
      carryIn,
      isNoSetoran: false,
      submittedBy: null as string | null,
      submittedAt: null as string | null,
      verifiedBy: name(task?.verifiedBy),
      verifiedAt: iso(task?.verifiedAt),
      correctionCount: change?.count ?? 0,
      addedByIt: change?.latestKind === 'create',
    };

    if (ledger) {
      balance = toInt(ledger.unpaidAmount);
      rows.push({
        ...base,
        kind: 'submitted',
        balance,
        received: toInt(ledger.actualReceivedAmount),
        required: toInt(ledger.requiredStoreAmount),
        stored: toInt(ledger.storedAmount),
        unpaid: balance,
        isNoSetoran: ledger.isNoSetoran,
        submittedBy: name(ledger.completedBy),
        submittedAt: iso(task?.completedAt),
      });
    } else if (task) {
      const done = task.status === 'completed';
      rows.push({
        ...base,
        kind: done ? 'orphan' : 'draft',
        balance,
        received: toIntOrNull(task.expectedAmount),
        required: null,
        stored: toIntOrNull(task.amount),
        unpaid: null,
        isNoSetoran: task.isNoSetoran,
        submittedBy: done ? name(task.completedBy) : null,
        submittedAt: done ? iso(task.completedAt) : null,
      });
    } else {
      rows.push({ ...base, kind: 'empty', balance, received: null, required: null, stored: null, unpaid: null });
    }
  }

  const corrections: SetoranCorrectionEntry[] = correctionRows.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    kind: c.kind,
    date: dayKey(c.date),
    reason: c.reason,
    correctedBy: name(c.correctedBy) ?? c.correctedBy,
    createdAt: c.createdAt.toISOString(),
    before: { received: toInt(c.beforeReceived), stored: toInt(c.beforeStored), unpaid: toInt(c.beforeUnpaid) },
    after: { received: toInt(c.afterReceived), stored: toInt(c.afterStored), unpaid: toInt(c.afterUnpaid) },
    wasVerified: c.wasVerified,
    affectedDays: c.cascade.length,
  }));

  return { store, today, rows, corrections };
}

/**
 * Latest correction per task — Finance's daily review shows it next to the
 * figures so a number that no longer matches the resi photo is explained.
 */
export async function getLatestCorrectionsByTask(
  taskIds: number[],
): Promise<Map<number, { by: string; at: string; reason: string; kind: 'correct' | 'create' }>> {
  if (taskIds.length === 0) return new Map();

  const rows = await db
    .select({
      taskId: setoranCorrections.taskId,
      kind: setoranCorrections.kind,
      reason: setoranCorrections.reason,
      createdAt: setoranCorrections.createdAt,
      by: users.name,
    })
    .from(setoranCorrections)
    .innerJoin(users, eq(users.id, setoranCorrections.correctedBy))
    .where(inArray(setoranCorrections.taskId, taskIds))
    .orderBy(desc(setoranCorrections.createdAt));

  const latest = new Map<number, { by: string; at: string; reason: string; kind: 'correct' | 'create' }>();
  for (const r of rows) {
    if (!latest.has(r.taskId)) {
      latest.set(r.taskId, { by: r.by, at: r.createdAt.toISOString(), reason: r.reason, kind: r.kind });
    }
  }
  return latest;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface ApplyCorrectionData {
  /** Later days whose sisa kemarin / sisa were recalculated. */
  affectedDays: number;
  closingBefore: number;
  closingAfter: number;
}

// The transaction handle drizzle passes to db.transaction() callbacks.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Per-store mutex: corrections and additions on the same store queue up, so a
 * day can't be inserted into a chain while another change is recalculating it.
 */
async function lockStore(tx: Tx, storeId: number): Promise<void> {
  await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).for('update');
}

/** Writes the recalculated carry-over of the days after the changed one. */
async function writeTail(tx: Tx, rows: PlannedRow[], now: Date): Promise<PlannedRow[]> {
  const tail = rows.filter((r) => !r.isTarget && r.changed);
  for (const p of tail) {
    await tx
      .update(setoranMoneyStorage)
      .set({
        previousUnpaidAmount: money(p.carryIn),
        requiredStoreAmount: money(p.required),
        unpaidAmount: money(p.unpaid),
        updatedAt: now,
      })
      .where(eq(setoranMoneyStorage.taskId, p.taskId));

    await tx
      .update(setoranTasks)
      .set({
        carriedDeficit: money(p.carryIn),
        carriedDeficitFetchedAt: now,
        unpaidAmount: money(p.unpaid),
        updatedAt: now,
      })
      .where(eq(setoranTasks.id, p.taskId));
  }
  return tail;
}

const toChain = (l: typeof setoranMoneyStorage.$inferSelect): LedgerChainRow => ({
  taskId: l.taskId,
  date: dayKey(l.date),
  received: toInt(l.actualReceivedAmount),
  carryIn: toInt(l.previousUnpaidAmount),
  required: toInt(l.requiredStoreAmount),
  stored: toInt(l.storedAmount),
  unpaid: toInt(l.unpaidAmount),
});

export interface ApplyCorrectionInput {
  taskId: number;
  /** Uang aktual diterima, integer Rupiah. */
  received: number;
  /** Nominal disetor, integer Rupiah. */
  stored: number;
  reason: string;
  correctedBy: string;
}

/** Corrects the amounts of a submitted day and recalculates the days after it. */
export async function applySetoranCorrection(
  input: ApplyCorrectionInput,
): Promise<CorrectionResult<ApplyCorrectionData>> {
  const reason = validateCorrectionReason(input.reason);
  if (!reason.ok) return { success: false, error: reason.error, status: 400 };

  return db.transaction(async (tx): Promise<CorrectionResult<ApplyCorrectionData>> => {
    const [task] = await tx
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.id, input.taskId))
      .limit(1);
    if (!task) return { success: false, error: 'Setoran tidak ditemukan.', status: 404 };

    await lockStore(tx, task.storeId);

    // Re-read under the lock so a change that just finished is seen.
    const [locked] = await tx
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.id, input.taskId))
      .for('update')
      .limit(1);
    if (!locked) return { success: false, error: 'Setoran tidak ditemukan.', status: 404 };
    if (locked.status !== 'completed') {
      return { success: false, error: 'Hanya setoran yang sudah disubmit yang bisa dikoreksi.', status: 409 };
    }

    const [targetLedger] = await tx
      .select({ date: setoranMoneyStorage.date })
      .from(setoranMoneyStorage)
      .where(eq(setoranMoneyStorage.taskId, locked.id))
      .limit(1);
    if (!targetLedger) {
      return { success: false, error: 'Data ledger setoran hari ini tidak ditemukan.', status: 404 };
    }

    // The corrected day plus its tail, in date order.
    const chainRows = await tx
      .select()
      .from(setoranMoneyStorage)
      .where(and(
        eq(setoranMoneyStorage.storeId, locked.storeId),
        gte(setoranMoneyStorage.date, targetLedger.date),
      ))
      .orderBy(asc(setoranMoneyStorage.date))
      .for('update');

    if (chainRows[0]?.taskId !== locked.id) {
      return { success: false, error: 'Data ledger setoran hari ini tidak ditemukan.', status: 404 };
    }

    const plan = planSetoranCorrection(chainRows.map(toChain), { received: input.received, stored: input.stored });
    if (!plan.ok) return { success: false, error: plan.error, status: 400 };
    if (plan.noChange) {
      return { success: false, error: 'Nominal sama dengan yang tercatat — tidak ada yang dikoreksi.', status: 400 };
    }

    const now = new Date();
    const head = plan.rows[0];

    await tx
      .update(setoranMoneyStorage)
      .set({
        actualReceivedAmount: money(head.received),
        requiredStoreAmount: money(head.required),
        storedAmount: money(head.stored),
        unpaidAmount: money(head.unpaid),
        isNoSetoran: head.received === 0,
        updatedAt: now,
      })
      .where(eq(setoranMoneyStorage.taskId, head.taskId));

    // The figures changed, so a Finance sign-off on the old ones no longer holds.
    await tx
      .update(setoranTasks)
      .set({
        expectedAmount: money(head.received),
        amount: money(head.stored),
        unpaidAmount: money(head.unpaid),
        isNoSetoran: head.received === 0,
        verifiedBy: null,
        verifiedAt: null,
        updatedAt: now,
      })
      .where(eq(setoranTasks.id, head.taskId));

    const tail = await writeTail(tx, plan.rows, now);

    await tx.insert(setoranCorrections).values({
      taskId: locked.id,
      storeId: locked.storeId,
      date: locked.date,
      kind: 'correct',
      reason: reason.reason,
      beforeReceived: money(head.before.received),
      beforeStored: money(head.before.stored),
      beforeUnpaid: money(head.before.unpaid),
      afterReceived: money(head.received),
      afterStored: money(head.stored),
      afterUnpaid: money(head.unpaid),
      wasVerified: locked.verifiedAt != null,
      cascade: tail.map(cascadeEntry),
      correctedBy: input.correctedBy,
      createdAt: now,
    });

    return {
      success: true,
      data: { affectedDays: tail.length, closingBefore: plan.closingBefore, closingAfter: plan.closingAfter },
    };
  });
}

export interface CreateSetoranInput {
  storeId: number;
  /** YYYY-MM-DD — a day with no submitted setoran, today or earlier (Jakarta). */
  date: string;
  received: number;
  stored: number;
  reason: string;
  createdBy: string;
}

export interface CreateSetoranData extends ApplyCorrectionData {
  taskId: number;
}

/**
 * Fills in a day that has no submitted setoran (nothing at all, or a draft that
 * was never submitted), then recalculates the days after it — they now carry the
 * new day's sisa instead of skipping over it.
 */
export async function createSetoranForDate(
  input: CreateSetoranInput,
): Promise<CorrectionResult<CreateSetoranData>> {
  const reason = validateCorrectionReason(input.reason);
  if (!reason.ok) return { success: false, error: reason.error, status: 400 };

  const bounds = dayBounds(input.date);
  if (!bounds) return { success: false, error: 'Tanggal tidak valid.', status: 400 };
  if (input.date > todayJakarta()) {
    return { success: false, error: 'Setoran tidak bisa ditambahkan untuk tanggal yang belum terjadi.', status: 400 };
  }

  const morningShiftId = await getMorningShiftId();

  return db.transaction(async (tx): Promise<CorrectionResult<CreateSetoranData>> => {
    const [store] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, input.storeId))
      .limit(1);
    if (!store) return { success: false, error: 'Store tidak ditemukan.', status: 404 };

    await lockStore(tx, input.storeId);

    const inDay = (col: typeof setoranMoneyStorage.date | typeof setoranTasks.date) =>
      and(gte(col, bounds.start), lt(col, bounds.end));

    const [existingLedger] = await tx
      .select({ taskId: setoranMoneyStorage.taskId })
      .from(setoranMoneyStorage)
      .where(and(eq(setoranMoneyStorage.storeId, input.storeId), inDay(setoranMoneyStorage.date)))
      .limit(1);
    if (existingLedger) {
      return { success: false, error: 'Tanggal ini sudah ada setorannya — gunakan Koreksi.', status: 409 };
    }

    const [existingTask] = await tx
      .select()
      .from(setoranTasks)
      .where(and(eq(setoranTasks.storeId, input.storeId), inDay(setoranTasks.date)))
      .for('update')
      .limit(1);
    if (existingTask?.status === 'completed') {
      return {
        success: false,
        error: 'Setoran tanggal ini sudah ditandai selesai tetapi tanpa data ledger — tidak bisa diisi dari sini.',
        status: 409,
      };
    }

    // Balance coming into the day = the latest ledger row before it.
    const [prior] = await tx
      .select({ unpaid: setoranMoneyStorage.unpaidAmount })
      .from(setoranMoneyStorage)
      .where(and(eq(setoranMoneyStorage.storeId, input.storeId), lt(setoranMoneyStorage.date, bounds.start)))
      .orderBy(desc(setoranMoneyStorage.date))
      .limit(1);
    const carryIn = toInt(prior?.unpaid);

    const laterRows = await tx
      .select()
      .from(setoranMoneyStorage)
      .where(and(eq(setoranMoneyStorage.storeId, input.storeId), gte(setoranMoneyStorage.date, bounds.end)))
      .orderBy(asc(setoranMoneyStorage.date))
      .for('update');

    const placeholder: LedgerChainRow = {
      taskId: 0,
      date: input.date,
      received: 0,
      carryIn,
      required: carryIn,
      stored: 0,
      unpaid: carryIn,
    };
    const plan = planSetoranCorrection(
      [placeholder, ...laterRows.map(toChain)],
      { received: input.received, stored: input.stored },
      { isNew: true },
    );
    if (!plan.ok) return { success: false, error: plan.error, status: 400 };

    const now = new Date();
    const head = plan.rows[0];
    const isNoSetoran = head.received === 0;
    const actors = {
      actualReceivedAmountBy: input.createdBy,
      actualReceivedAmountAt: now,
      storedAmountBy: input.createdBy,
      storedAmountAt: now,
      completedBy: input.createdBy,
    };

    const taskValues = {
      expectedAmount: money(head.received),
      amount: money(head.stored),
      carriedDeficit: money(carryIn),
      carriedDeficitFetchedAt: now,
      unpaidAmount: money(head.unpaid),
      isNoSetoran,
      ...actors,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    let task: typeof setoranTasks.$inferSelect;
    if (existingTask) {
      // A draft nobody submitted: complete it in place (its photos / notes stay).
      [task] = await tx
        .update(setoranTasks)
        .set(taskValues)
        .where(eq(setoranTasks.id, existingTask.id))
        .returning();
    } else {
      [task] = await tx
        .insert(setoranTasks)
        .values({
          scheduleId: null,
          userId: input.createdBy,
          storeId: input.storeId,
          shiftId: morningShiftId,
          date: bounds.start,
          ...taskValues,
          createdAt: now,
        })
        .returning();
    }

    await tx.insert(setoranMoneyStorage).values({
      taskId: task.id,
      scheduleId: task.scheduleId,
      userId: task.userId,
      storeId: task.storeId,
      shiftId: task.shiftId,
      date: task.date,
      actualReceivedAmount: money(head.received),
      previousUnpaidAmount: money(carryIn),
      requiredStoreAmount: money(head.required),
      storedAmount: money(head.stored),
      unpaidAmount: money(head.unpaid),
      isNoSetoran,
      resiPhoto: task.resiPhoto,
      atmCardSelfiePhoto: task.atmCardSelfiePhoto,
      cashierPhoto: task.cashierPhoto,
      atmCardPhoto: task.atmCardPhoto,
      notes: task.notes,
      ...actors,
      createdAt: now,
      updatedAt: now,
    });

    const tail = await writeTail(tx, plan.rows, now);

    await tx.insert(setoranCorrections).values({
      taskId: task.id,
      storeId: task.storeId,
      date: task.date,
      kind: 'create',
      reason: reason.reason,
      beforeReceived: money(0),
      beforeStored: money(0),
      beforeUnpaid: money(carryIn),
      afterReceived: money(head.received),
      afterStored: money(head.stored),
      afterUnpaid: money(head.unpaid),
      wasVerified: false,
      cascade: tail.map(cascadeEntry),
      correctedBy: input.createdBy,
      createdAt: now,
    });

    return {
      success: true,
      data: {
        taskId: task.id,
        affectedDays: tail.length,
        closingBefore: plan.closingBefore,
        closingAfter: plan.closingAfter,
      },
    };
  });
}

function cascadeEntry(r: PlannedRow) {
  return {
    taskId: r.taskId,
    date: r.date,
    carryIn: [r.before.carryIn, r.carryIn] as [number, number],
    unpaid: [r.before.unpaid, r.unpaid] as [number, number],
  };
}
