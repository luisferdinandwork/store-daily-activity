// lib/db/utils/open-statement.ts
// ─────────────────────────────────────────────────────────────────────────────
// Open Statement task.
// Hold/carry-over chain:
//   • Evening task held            → carry-over on NEXT DAY morning shift.
//   • Morning carry-over held      → carry-over on the SAME DAY evening shift,
//                                     so that evening has its normal Open
//                                     Statement + the carry-over (2 tasks).
//   • The chain repeats: held evening → next morning, held morning → same evening.
//
// Carry-overs are generated at hold time (generateCarryOverForHeldTask) AND
// re-checked during materialisation (materialiseOpenStatementTask) as a safety
// net. Both are idempotent: a parent never spawns more than one child.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, lt, desc } from 'drizzle-orm';
import {
  openStatementTasks, stores, shifts, attendance, schedules,
  type OpenStatementTask,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export type OpenStatementDecision = 'done' | 'hold';

export interface SubmitOpenStatementInput {
  taskId?: number;          // preferred: disambiguates when a schedule owns 2 tasks
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  decision: OpenStatementDecision;
  holdReason?: string;
  notes?: string;
}

export interface AutoSaveOpenStatementPatch {
  decision?: OpenStatementDecision | null;
  holdReason?: string | null;
  notes?: string;
}

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return startOfDay(r); }

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getShiftMaps() {
  const rows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const idToCode = new Map<number, string>();
  const codeToId = new Map<string, number>();
  for (const r of rows) { idToCode.set(r.id, r.code); codeToId.set(r.code, r.id); }
  return { idToCode, codeToId };
}

async function getShiftCode(shiftId: number): Promise<string | null> {
  const [row] = await db.select({ code: shifts.code }).from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  return row?.code ?? null;
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db.select({ checkInTime: attendance.checkInTime }).from(attendance).where(eq(attendance.scheduleId, scheduleId)).limit(1);
  if (!att?.checkInTime) return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  return null;
}

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db.select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;
  const dist = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;
  return dist > radius ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.` : null;
}

async function assertCanProgressTask(scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) return assertInGeofence(storeId, geo);
  return null;
}

// ─── Carry-over generation ─────────────────────────────────────────────────────

/**
 * Ensures a held parent task has exactly one child carry-over.
 * Returns true if it created one, false if a child already existed.
 */
async function ensureChildCarryOver(
  parent: OpenStatementTask,
  opts: { scheduleId: number; userId: string; storeId: number; shiftId: number; date: Date; fallbackNote: string },
): Promise<boolean> {
  const [existingChild] = await db
    .select({ id: openStatementTasks.id })
    .from(openStatementTasks)
    .where(eq(openStatementTasks.parentTaskId, parent.id))
    .limit(1);
  if (existingChild) return false;

  await db.insert(openStatementTasks).values({
    scheduleId: opts.scheduleId,
    userId: opts.userId,
    storeId: opts.storeId,
    shiftId: opts.shiftId,
    date: startOfDay(opts.date),
    parentTaskId: parent.id,
    status: 'pending',
    notes: parent.holdReason
      ? `Carry-over Open Statement: ${parent.holdReason}`
      : opts.fallbackNote,
  });
  return true;
}

/**
 * Called right after a task is held. Creates the next carry-over by looking up
 * the receiving shift's schedule:
 *   held evening → next-day morning,  held morning → same-day evening.
 * Idempotent. If the target schedule doesn't exist yet, materialisation retries.
 */
export async function generateCarryOverForHeldTask(held: OpenStatementTask): Promise<'created' | 'skipped'> {
  if (!held.isOnHold || held.shiftId == null) return 'skipped';

  const { idToCode, codeToId } = await getShiftMaps();
  const heldCode = idToCode.get(held.shiftId);

  let targetCode: 'morning' | 'evening';
  let targetDate: Date;
  const heldDate = startOfDay(new Date(held.date));

  if (heldCode === 'morning') {
    targetCode = 'evening';
    targetDate = heldDate;            // same day
  } else {
    targetCode = 'morning';
    targetDate = addDays(heldDate, 1); // next day (covers evening + any unknown)
  }

  const targetShiftId = codeToId.get(targetCode);
  if (!targetShiftId) return 'skipped';

  const fullDayId = codeToId.get('full_day');
  const candidateShiftIds = [targetShiftId, fullDayId].filter((x): x is number => x != null);

  // A schedule on the target date that covers the target shift (or full_day).
  const [targetSchedule] = await db
    .select({ id: schedules.id, userId: schedules.userId })
    .from(schedules)
    .where(and(
      eq(schedules.storeId, held.storeId),
      gte(schedules.date, startOfDay(targetDate)),
      lte(schedules.date, endOfDay(targetDate)),
      inArray(schedules.shiftId, candidateShiftIds),
    ))
    .orderBy(schedules.shiftId)
    .limit(1);

  if (!targetSchedule) return 'skipped';

  const created = await ensureChildCarryOver(held, {
    scheduleId: targetSchedule.id,
    userId: targetSchedule.userId,
    storeId: held.storeId,
    shiftId: targetShiftId,           // store resolved morning/evening id
    date: targetDate,
    fallbackNote: 'Carry-over Open Statement dari shift sebelumnya.',
  });

  return created ? 'created' : 'skipped';
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getActiveOpenStatementTask(storeId: number, date: Date): Promise<OpenStatementTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [today] = await db.select().from(openStatementTasks).where(and(
    eq(openStatementTasks.storeId, storeId),
    gte(openStatementTasks.date, dayStart),
    lte(openStatementTasks.date, dayEnd),
    inArray(openStatementTasks.status, ['pending', 'in_progress']),
  )).orderBy(openStatementTasks.createdAt).limit(1);
  if (today) return today;

  const [carry] = await db.select().from(openStatementTasks).where(and(
    eq(openStatementTasks.storeId, storeId),
    eq(openStatementTasks.isOnHold, true),
    isNull(openStatementTasks.parentTaskId),
  )).orderBy(desc(openStatementTasks.createdAt)).limit(1);

  return carry ?? null;
}

export async function submitOpenStatement(input: SubmitOpenStatementInput): Promise<TaskResult<OpenStatementTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (input.decision !== 'done' && input.decision !== 'hold') return { success: false, error: 'Pilih status Open Statement: Done atau On Hold.' };
    if (input.decision === 'hold' && !input.holdReason?.trim()) return { success: false, error: 'Alasan On Hold wajib diisi.' };

    // Resolve by taskId when available (a schedule may own 2 Open Statements).
    const [task] = input.taskId
      ? await db.select().from(openStatementTasks).where(eq(openStatementTasks.id, input.taskId)).limit(1)
      : await db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, input.scheduleId)).limit(1);

    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah final.' };

    const now = new Date();
    const isHold = input.decision === 'hold';

    const [updated] = await db.update(openStatementTasks).set({
      isDone: !isHold,
      isOnHold: isHold,
      holdReason: isHold ? input.holdReason : null,
      heldBy: isHold ? input.userId : null,
      heldAt: isHold ? now : null,
      isBalanced: true,
      status: 'completed',
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      completedAt: now,
      updatedAt: now,
    }).where(eq(openStatementTasks.id, task.id)).returning();

    // On hold, spin up the next carry-over immediately (idempotent).
    if (isHold) {
      try {
        await generateCarryOverForHeldTask(updated);
      } catch (err) {
        console.error('[OpenStatement] carry-over generation failed:', err);
      }
    }

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitOpenStatement: ${err}` };
  }
}

export async function autoSaveOpenStatement(taskId: number, patch: AutoSaveOpenStatementPatch): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db.select({ id: openStatementTasks.id, status: openStatementTasks.status }).from(openStatementTasks).where(eq(openStatementTasks.id, taskId)).limit(1);
    if (!existing) return { success: false, error: 'Task not found.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('decision' in patch) {
      update.isDone = patch.decision === 'done';
      update.isOnHold = patch.decision === 'hold';
    }
    if ('holdReason' in patch) update.holdReason = patch.holdReason;
    if ('notes' in patch) update.notes = patch.notes;
    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(openStatementTasks).set(update).where(eq(openStatementTasks.id, existing.id));
    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveOpenStatement: ${err}` };
  }
}

export async function getOpenStatementBySchedule(scheduleId: number): Promise<OpenStatementTask | null> {
  const [row] = await db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, scheduleId)).limit(1);
  return row ?? null;
}

export async function getOpenStatementById(id: number): Promise<OpenStatementTask | null> {
  const [row] = await db.select().from(openStatementTasks).where(eq(openStatementTasks.id, id)).limit(1);
  return row ?? null;
}

// ─── Materialise (safety net) ──────────────────────────────────────────────────

export async function materialiseOpenStatementTask(scheduleId: number, userId: string, storeId: number, shiftId: number, date: Date): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const { idToCode, codeToId } = await getShiftMaps();
  const shiftCode = idToCode.get(shiftId) ?? null;

  const isMorning = shiftCode === 'morning' || shiftCode === 'full_day';
  const isEvening = shiftCode === 'evening' || shiftCode === 'full_day';
  const morningId = codeToId.get('morning') ?? shiftId;
  const eveningId = codeToId.get('evening') ?? shiftId;

  let createdAny = false;

  // (A) Morning: carry-over from a held EVENING statement on a prior day.
  if (isMorning) {
    const heldEvenings = await db.select().from(openStatementTasks).where(and(
      eq(openStatementTasks.storeId, storeId),
      eq(openStatementTasks.isOnHold, true),
      eq(openStatementTasks.shiftId, eveningId),
      lt(openStatementTasks.date, dayStart),
    )).orderBy(desc(openStatementTasks.date), desc(openStatementTasks.createdAt));

    for (const held of heldEvenings) {
      const made = await ensureChildCarryOver(held, {
        scheduleId, userId, storeId, shiftId: morningId, date: dayStart,
        fallbackNote: 'Carry-over Open Statement dari shift malam sebelumnya.',
      });
      if (made) createdAny = true;
    }
  }

  // (B) Evening: the normal Open Statement (one primary per store/day).
  if (isEvening) {
    const [primary] = await db.select({ id: openStatementTasks.id }).from(openStatementTasks).where(and(
      eq(openStatementTasks.storeId, storeId),
      gte(openStatementTasks.date, dayStart),
      lte(openStatementTasks.date, dayEnd),
      isNull(openStatementTasks.parentTaskId),
    )).limit(1);

    if (!primary) {
      await db.insert(openStatementTasks).values({
        scheduleId, userId, storeId, shiftId: eveningId, date: dayStart,
        parentTaskId: null,
        status: 'pending',
      });
      createdAny = true;
    }

    // (C) Evening: carry-over from a held MORNING statement on the SAME day.
    const heldMornings = await db.select().from(openStatementTasks).where(and(
      eq(openStatementTasks.storeId, storeId),
      eq(openStatementTasks.isOnHold, true),
      eq(openStatementTasks.shiftId, morningId),
      gte(openStatementTasks.date, dayStart),
      lte(openStatementTasks.date, dayEnd),
    )).orderBy(desc(openStatementTasks.createdAt));

    for (const held of heldMornings) {
      const made = await ensureChildCarryOver(held, {
        scheduleId, userId, storeId, shiftId: eveningId, date: dayStart,
        fallbackNote: 'Carry-over Open Statement dari shift pagi.',
      });
      if (made) createdAny = true;
    }
  }

  return createdAny ? 'created' : 'skipped';
}