// lib/db/utils/store-cash-count.ts
//
// Daily cashier cash-count + buddy selfie. ONE row per (store, calendar day):
// an employee counts the total cash in the cashier drawer, picks a colleague
// also scheduled that day as a witness, and the two take a selfie together.
// Required before any morning / full_day employee can check out.
import { db } from '@/lib/db';
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import {
  storeCashCounts,
  schedules,
  attendance,
  users,
  shifts,
  type StoreCashCount,
} from '@/lib/db/schema';
import { getMorningShiftId, startOfDay, endOfDay } from '@/lib/db/utils/shift-lookup';

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
  totalAmount: number;
  witnessUserId: string;
  selfiePhoto: string;
  notes?: string;
}

/** Cashier count is only required for shifts that open the store. */
export function isCashCountRequiredForShift(shiftCode: string): boolean {
  return shiftCode === 'morning' || shiftCode === 'full_day';
}

export async function getStoreCashCountForDate(
  storeId: number,
  date: Date,
): Promise<StoreCashCount | null> {
  const [row] = await db
    .select()
    .from(storeCashCounts)
    .where(
      and(
        eq(storeCashCounts.storeId, storeId),
        gte(storeCashCounts.date, startOfDay(date)),
        lte(storeCashCounts.date, endOfDay(date)),
      ),
    )
    .limit(1);

  return row ?? null;
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

export async function submitStoreCashCount(
  input: SubmitStoreCashCountInput,
): Promise<TaskResult<StoreCashCount>> {
  try {
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

    const today = startOfDay(new Date());

    // Idempotent — the ritual is once per store per day. If someone already
    // did it, return that row as success instead of erroring.
    const existing = await getStoreCashCountForDate(input.storeId, today);
    if (existing) return { success: true, data: existing };

    const [schedule] = await db
      .select({ date: schedules.date })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    const coScheduled = await listCoScheduledEmployees(input.userId, input.storeId, today);
    if (!coScheduled.some((e) => e.userId === input.witnessUserId)) {
      return { success: false, error: 'Rekan yang dipilih tidak memiliki jadwal hari ini.' };
    }

    const morningShiftId = await getMorningShiftId();
    const now = new Date();
    const dayBucket = startOfDay(schedule?.date ?? today);

    const [row] = await db
      .insert(storeCashCounts)
      .values({
        storeId: input.storeId,
        date: dayBucket,
        shiftId: morningShiftId,
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

    const saved = row ?? (await getStoreCashCountForDate(input.storeId, today));
    if (!saved) return { success: false, error: 'Gagal menyimpan hitung kas kasir.' };

    return { success: true, data: saved };
  } catch (err) {
    return {
      success: false,
      error: `submitStoreCashCount: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
