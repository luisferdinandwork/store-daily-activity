// lib/db/utils/setoran.ts
// ─────────────────────────────────────────────────────────────────────────────
// Utilities for the Setoran task — running-deficit model (no carry-forward row).
//
// Per-day lifecycle
// ─────────────────
//   • Each store gets exactly ONE setoran row per calendar day.
//   • A new row is created on demand (first-open) by getOrCreateSetoranForSchedule.
//     At creation, the row's `carriedDeficit` is snapshotted from the latest
//     completed setoran row for the same store on a prior date.
//   • Employee enters:
//         expectedAmount  → today's base deposit target
//         amount          → actual amount deposited (must be <= expected + carried)
//   • On submit:
//         totalDue      = expectedAmount + carriedDeficit
//         unpaidAmount  = max(0, totalDue - amount)
//         status        = 'completed' (always — even if unpaidAmount > 0)
//   • Tomorrow's row reads today's `unpaidAmount` into its own `carriedDeficit`.
//
// Access rules
// ────────────
//   • Employee must be checked in for their schedule.
//   • No geofence check.
//   • Overpayment is NOT allowed — amount is capped at totalDue server-side.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import {
  setoranTasks, shifts, attendance, schedules,
  type SetoranTask,
} from '@/lib/db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface SubmitSetoranInput {
  scheduleId:          number;
  userId:              string;
  storeId:             number;
  expectedAmount:      string;
  amount:              string;
  resiPhoto:           string;
  atmCardSelfiePhoto:  string;
  notes?:              string;
}
// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

let _morningShiftIdCache: number | null = null;
async function getMorningShiftId(): Promise<number> {
  if (_morningShiftIdCache != null) return _morningShiftIdCache;
  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, 'morning'))
    .limit(1);
  if (!row) throw new Error('Morning shift not found in shifts table.');
  _morningShiftIdCache = row.id;
  return row.id;
}

function parseAmount(raw: string | null | undefined): number {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return isFinite(n) && n > 0 ? n : 0;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);
  if (!att?.checkInTime)
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  return null;
}

// ─── Deficit lookup ───────────────────────────────────────────────────────────

/**
 * Returns the unpaid amount from the most recent prior-date setoran row for
 * this store. Used to seed a new row's carriedDeficit.
 *
 * Returns '0' if there is no prior row or yesterday's row was fully paid.
 */
async function getPriorUnpaidForStore(
  storeId: number,
  beforeDate: Date,
): Promise<string> {
  const dayStart = startOfDay(beforeDate);

  const [prior] = await db
    .select({
      unpaidAmount: setoranTasks.unpaidAmount,
      status:       setoranTasks.status,
    })
    .from(setoranTasks)
    .where(and(
      eq(setoranTasks.storeId, storeId),
      lt(setoranTasks.date, dayStart),
    ))
    .orderBy(desc(setoranTasks.date))
    .limit(1);

  if (!prior) return '0';
  // Only completed rows contribute their unpaid amount to the next day.
  // A pending/in_progress prior row shouldn't happen under normal flow, but
  // if it does we treat it as "no data yet" and carry 0.
  if (prior.status !== 'completed' && prior.status !== 'verified') return '0';
  return prior.unpaidAmount ?? '0';
}

// ─── Row creation / idempotent fetch ──────────────────────────────────────────

/**
 * Returns the setoran row for a given schedule, creating it if missing.
 *
 * The new row is seeded with:
 *   • carriedDeficit = unpaidAmount from the most recent prior-day setoran row
 *     for this store (or 0 if none).
 *   • status = 'pending'
 *   • amount, expectedAmount, resiPhoto, atmCardSelfiePhoto = null (employee fills in)
 *  *
 * If a row already exists for this schedule it is returned as-is.
 */
export async function getOrCreateSetoranForSchedule(
  scheduleId: number,
): Promise<TaskResult<SetoranTask>> {
  try {
    // Fast path: row already exists
    const [existing] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, scheduleId))
      .limit(1);
    if (existing) return { success: true, data: existing };

    // Load the schedule to know what store/user/date we're working with
    const [sched] = await db
      .select({
        userId:  schedules.userId,
        storeId: schedules.storeId,
        date:    schedules.date,
      })
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    if (!sched) return { success: false, error: `Schedule ${scheduleId} not found.` };

    const dayStart       = startOfDay(sched.date);
    const morningShiftId = await getMorningShiftId();
    const now            = new Date();

    // Another row might already exist for this store+date even if this schedule
    // hasn't created one yet (two employees sharing the morning shift, for example).
    const [byStoreDate] = await db
      .select()
      .from(setoranTasks)
      .where(and(
        eq(setoranTasks.storeId, sched.storeId),
        eq(setoranTasks.date,    dayStart),
      ))
      .limit(1);
    if (byStoreDate) return { success: true, data: byStoreDate };

    const carriedDeficit = await getPriorUnpaidForStore(sched.storeId, dayStart);

    const [created] = await db
      .insert(setoranTasks)
      .values({
        scheduleId,
        userId:                   sched.userId,
        storeId:                  sched.storeId,
        shiftId:                  morningShiftId,
        date:                     dayStart,
        carriedDeficit,
        carriedDeficitFetchedAt:  now,
        unpaidAmount:             '0',
        status:                   'pending',
        createdAt:                now,
        updatedAt:                now,
      })
      .returning();

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: `getOrCreateSetoranForSchedule: ${err}` };
  }
}

/**
 * Returns the setoran row for a given store on a given date, if any.
 * Used by the tasks list route to resolve "today's setoran" for this store.
 */
export async function getSetoranForStoreDate(
  storeId: number,
  date: Date,
): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(and(
      eq(setoranTasks.storeId, storeId),
      eq(setoranTasks.date,    startOfDay(date)),
    ))
    .limit(1);
  return row ?? null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateSetoranPayload(input: SubmitSetoranInput): string | null {
  const expected = parseAmount(input.expectedAmount);
  if (expected <= 0) return 'Target setoran hari ini wajib diisi.';

  const amt = parseAmount(input.amount);
  if (amt <= 0) return 'Nominal setoran aktual wajib diisi.';

  if (!input.resiPhoto?.trim())          return 'Foto resi wajib diupload.';
  if (!input.atmCardSelfiePhoto?.trim()) return 'Foto selfie dengan kartu ATM wajib diupload.';
  return null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Submit (or re-submit) a setoran task.
 *
 * Behaviour:
 *   • Row is matched by scheduleId, or by (storeId, today's date) as a fallback
 *     for the case where another employee on the same shift created the row.
 *   • If no row exists, one is created on the fly (seeded with carriedDeficit
 *     from yesterday's unpaid).
 *   • Cap: amount must not exceed expectedAmount + carriedDeficit.
 *   • Status is ALWAYS set to 'completed' after a successful submit — the
 *     unpaid balance lives on the row as `unpaidAmount`, not as a status.
 */
export async function submitSetoran(
  input: SubmitSetoranInput,
): Promise<TaskResult<SetoranTask>> {
  try {
    const checkInErr = await assertCheckedIn(input.scheduleId);
    if (checkInErr) return { success: false, error: checkInErr };

    const validationErr = validateSetoranPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    // Ensure we have a row to update (idempotent).
    const ensured = await getOrCreateSetoranForSchedule(input.scheduleId);
    if (!ensured.success) return ensured;
    const existing = ensured.data;

    if (existing.status === 'verified')
      return { success: false, error: 'Setoran sudah diverifikasi.' };

    // ── Balance math ───────────────────────────────────────────────────────
    const expected = parseAmount(input.expectedAmount);
    const carried  = parseAmount(existing.carriedDeficit);
    const totalDue = expected + carried;
    const amt      = parseAmount(input.amount);

    if (amt > totalDue) {
      return {
        success: false,
        error: `Nominal disetor (${amt.toLocaleString('id-ID')}) melebihi total yang wajib disetor (${totalDue.toLocaleString('id-ID')}). Overpayment tidak diperbolehkan.`,
      };
    }

    const unpaid = Math.max(0, totalDue - amt);
    const now    = new Date();

    const [updated] = await db
      .update(setoranTasks)
      .set({
        scheduleId:         input.scheduleId,
        userId:             input.userId,
        expectedAmount:     String(expected),
        amount:             String(amt),
        unpaidAmount:       String(unpaid),
        resiPhoto:          input.resiPhoto,
        atmCardSelfiePhoto: input.atmCardSelfiePhoto,
        notes:              input.notes,
        status:             'completed',
        completedAt:        now,
        updatedAt:          now,
      })
      .where(eq(setoranTasks.id, existing.id))
      .returning();

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitSetoran: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export interface SetoranAutoSavePatch {
  amount?:              string;
  expectedAmount?:      string | null;
  resiPhoto?:           string | null;
  atmCardSelfiePhoto?:  string | null;
  notes?:               string;
}

export async function autoSaveSetoran(
  scheduleId: number,
  patch:      SetoranAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    // Make sure the row exists (creates it if first interaction).
    const ensured = await getOrCreateSetoranForSchedule(scheduleId);
    if (!ensured.success) return { success: false, error: ensured.error };
    const existing = ensured.data;

    if (existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    // If the task is already completed, still allow edits to fields because
    // the new model treats every submit as idempotent — but flip the status
    // back to in_progress so the UI knows there's unfinalised changes.
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('amount'              in patch) update.amount              = patch.amount;
    if ('expectedAmount'      in patch) update.expectedAmount      = patch.expectedAmount;
    if ('resiPhoto'           in patch) update.resiPhoto           = patch.resiPhoto ?? null;
    if ('atmCardSelfiePhoto'  in patch) update.atmCardSelfiePhoto  = patch.atmCardSelfiePhoto ?? null;
    if ('notes'               in patch) update.notes               = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(setoranTasks)
      .set(update)
      .where(eq(setoranTasks.id, existing.id));

    return {
      success: true,
      data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') },
    };
  } catch (err) {
    return { success: false, error: `autoSaveSetoran: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSetoranBySchedule(scheduleId: number): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getSetoranById(id: number): Promise<SetoranTask | null> {
  const [row] = await db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Returns the N most recent setoran rows for a store, newest first.
 * Useful for showing deficit history in the UI (optional).
 */
export async function getSetoranHistoryForStore(
  storeId: number,
  limit = 14,
): Promise<SetoranTask[]> {
  return db
    .select()
    .from(setoranTasks)
    .where(eq(setoranTasks.storeId, storeId))
    .orderBy(desc(setoranTasks.date))
    .limit(limit);
}