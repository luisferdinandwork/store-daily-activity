// lib/db/utils/store-cash-count.ts
//
// Cashier cash-count + buddy selfie. ONE row per (store, calendar day, SOP
// session) — see lib/cash-count-sessions.ts: an employee picks which of the
// five daily moments this is (Pagi, Siang 1, Siang 2, Sore, Malam), counts the
// total cash in the cashier drawer, picks a colleague also scheduled that day
// as a witness, and the two take a selfie together. All five are mandatory,
// enforced at checkout (requiredCashCountSessionsForShift).
import { db } from '@/lib/db';
import {
  CASH_COUNT_SESSIONS,
  CASH_COUNT_SESSION_INFO,
  isCashCountSession,
  type CashCountSession,
} from '@/lib/cash-count-sessions';
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import {
  storeCashCounts,
  schedules,
  attendance,
  users,
  shifts,
  type StoreCashCount,
} from '@/lib/db/schema';
import { startOfDay, endOfDay } from '@/lib/db/utils/shift-lookup';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface CoScheduledEmployee {
  userId: string;
  name: string;
  shiftLabel: string | null;
}

export interface SubmitStoreCashCountInput {
  userId: string;
  scheduleId: number;
  storeId: number;
  session: CashCountSession;
  totalAmount: number;
  witnessUserId: string;
  selfiePhoto: string;
  notes?: string;
}

/** Every session counted at this store/day, in SOP order. */
export async function getStoreCashCountsForDate(
  storeId: number,
  date: Date,
): Promise<StoreCashCount[]> {
  const rows = await db
    .select()
    .from(storeCashCounts)
    .where(
      and(
        eq(storeCashCounts.storeId, storeId),
        gte(storeCashCounts.date, startOfDay(date)),
        lte(storeCashCounts.date, endOfDay(date)),
      ),
    );

  return rows.sort(
    (a, b) => CASH_COUNT_SESSIONS.indexOf(a.session) - CASH_COUNT_SESSIONS.indexOf(b.session),
  );
}

export async function getStoreCashCountForSession(
  storeId: number,
  date: Date,
  session: CashCountSession,
): Promise<StoreCashCount | null> {
  const [row] = await db
    .select()
    .from(storeCashCounts)
    .where(
      and(
        eq(storeCashCounts.storeId, storeId),
        eq(storeCashCounts.session, session),
        gte(storeCashCounts.date, startOfDay(date)),
        lte(storeCashCounts.date, endOfDay(date)),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * The caller's own schedule at this store/day to record a count against —
 * any shift (the SOP has siang / closing staff counting too), preferring one
 * they've checked in on. Null when they aren't scheduled there that day.
 */
export async function resolveCashCountScheduleId(
  userId: string,
  storeId: number,
  date: Date,
): Promise<number | null> {
  const rows = await db
    .select({ id: schedules.id, checkInTime: attendance.checkInTime })
    .from(schedules)
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.userId, userId),
        eq(schedules.storeId, storeId),
        eq(schedules.isHoliday, false),
        gte(schedules.date, startOfDay(date)),
        lte(schedules.date, endOfDay(date)),
      ),
    );

  return (rows.find((r) => r.checkInTime) ?? rows[0])?.id ?? null;
}

/** Employees (other than `userId`) with a working schedule at this store/day. */
export async function listCoScheduledEmployees(
  userId: string,
  storeId: number,
  date: Date,
): Promise<CoScheduledEmployee[]> {
  const rows = await db
    .select({
      userId: schedules.userId,
      name: users.name,
      shiftLabel: shifts.label,
    })
    .from(schedules)
    .innerJoin(users, eq(users.id, schedules.userId))
    .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
    .where(
      and(
        eq(schedules.storeId, storeId),
        eq(schedules.isHoliday, false),
        ne(schedules.userId, userId),
        gte(schedules.date, startOfDay(date)),
        lte(schedules.date, endOfDay(date)),
      ),
    );

  const byUser = new Map<string, CoScheduledEmployee>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, { userId: r.userId, name: r.name, shiftLabel: r.shiftLabel });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (!att?.checkInTime) {
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu.';
  }
  return null;
}

async function sessionAlreadyCounted(
  row: StoreCashCount,
  userId: string,
): Promise<TaskResult<StoreCashCount>> {
  if (row.countedByUserId === userId) return { success: true, data: row };

  const [counter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.countedByUserId))
    .limit(1);
  const label = CASH_COUNT_SESSION_INFO[row.session].label;
  return {
    success: false,
    error: `Hitung kas sesi ${label} sudah diisi${counter ? ` oleh ${counter.name}` : ''}.`,
  };
}

export async function submitStoreCashCount(
  input: SubmitStoreCashCountInput,
): Promise<TaskResult<StoreCashCount>> {
  try {
    if (!isCashCountSession(input.session)) {
      return { success: false, error: 'Pilih waktu hitung kas terlebih dahulu.' };
    }

    const checkInErr = await assertCheckedIn(input.scheduleId);
    if (checkInErr) return { success: false, error: checkInErr };

    const total = Number(input.totalAmount);
    if (!Number.isInteger(total) || total <= 0) {
      return { success: false, error: 'Total uang di kasir harus berupa angka lebih dari 0.' };
    }

    if (!input.selfiePhoto || typeof input.selfiePhoto !== 'string') {
      return { success: false, error: 'Foto bersama rekan wajib diambil terlebih dahulu.' };
    }

    if (!input.witnessUserId || input.witnessUserId === input.userId) {
      return { success: false, error: 'Pilih rekan lain untuk foto bersama.' };
    }

    const [schedule] = await db
      .select({ date: schedules.date, shiftId: schedules.shiftId })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);
    if (!schedule) return { success: false, error: 'Jadwal tidak ditemukan.' };

    const dayBucket = startOfDay(schedule.date);

    // Once per store/day/session. A repeat submit by the same counter (double
    // tap) returns their row; anyone else is told who already did it.
    const existing = await getStoreCashCountForSession(input.storeId, dayBucket, input.session);
    if (existing) return sessionAlreadyCounted(existing, input.userId);

    const coScheduled = await listCoScheduledEmployees(input.userId, input.storeId, dayBucket);
    if (!coScheduled.some((e) => e.userId === input.witnessUserId)) {
      return { success: false, error: 'Rekan yang dipilih tidak memiliki jadwal hari ini.' };
    }

    const now = new Date();

    const [row] = await db
      .insert(storeCashCounts)
      .values({
        storeId: input.storeId,
        date: dayBucket,
        session: input.session,
        shiftId: schedule.shiftId,
        totalAmount: String(total),
        countedByUserId: input.userId,
        countedByScheduleId: input.scheduleId,
        witnessUserId: input.witnessUserId,
        selfiePhoto: input.selfiePhoto,
        notes: input.notes ?? null,
        completedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (row) return { success: true, data: row };

    // Lost a race with a concurrent submit for the same session.
    const winner = await getStoreCashCountForSession(input.storeId, dayBucket, input.session);
    if (!winner) return { success: false, error: 'Gagal menyimpan hitung kas kasir.' };
    return sessionAlreadyCounted(winner, input.userId);
  } catch (err) {
    return {
      success: false,
      error: `submitStoreCashCount: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
