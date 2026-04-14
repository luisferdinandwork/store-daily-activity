// lib/db/utils/open-statement.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the Open Statement task.
//
// Employee opens the system's Open Statement menu and enters the amount
// shown. The task pulls an "expected" amount from the dummy generator
// (simulating a back-office data source). If expected != actual, the task
// goes into discrepancy until the next shift resolves it.
//
// Lifecycle mirrors EDC Reconciliation:
//   • Expected amount is stable per task (stored in expectedAmount column
//     on first open).
//   • isBalanced = expectedAmount === actualAmount.
//   • discrepancyStartedAt / discrepancyResolvedAt / discrepancyDurationMinutes
//     are stamped on transitions.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull } from 'drizzle-orm';
import {
  openStatementTasks, stores, shifts, attendance,
  type OpenStatementTask,
} from '@/lib/db/schema';
import { generateExpectedOpenStatement } from './dummy-evening-data';

// ─── Public types ─────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export interface SubmitOpenStatementInput {
  scheduleId:   number;
  userId:       string;
  storeId:      number;
  geo:          GeoPoint;
  skipGeo?:     boolean;
  actualAmount: string;      // numeric string
  notes?:       string;
}

export interface AutoSaveOpenStatementPatch {
  actualAmount?: string;
  notes?:        string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let _eveningShiftIdCache: number | null = null;
async function getEveningShiftId(): Promise<number> {
  if (_eveningShiftIdCache != null) return _eveningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'evening')).limit(1);
  if (!row) throw new Error('Evening shift not found in shifts table.');
  _eveningShiftIdCache = row.id;
  return row.id;
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

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                   return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }
  return null;
}

// ─── Expected amount fetch (idempotent) ──────────────────────────────────────

/**
 * Ensure the task has an expectedAmount. First open generates and stores.
 * Subsequent opens return the existing value.
 */
export async function fetchExpectedForTask(
  taskId: number,
): Promise<TaskResult<{ expectedAmount: number }>> {
  try {
    const [task] = await db
      .select()
      .from(openStatementTasks)
      .where(eq(openStatementTasks.id, taskId))
      .limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };

    if (task.expectedAmount != null)
      return { success: true, data: { expectedAmount: Number(task.expectedAmount) } };

    const gen = generateExpectedOpenStatement(task.storeId, task.date, task.id);

    await db
      .update(openStatementTasks)
      .set({
        expectedAmount:    String(gen.amount),
        expectedFetchedAt: new Date(),
        updatedAt:         new Date(),
      })
      .where(eq(openStatementTasks.id, taskId));

    return { success: true, data: { expectedAmount: gen.amount } };
  } catch (err) {
    return { success: false, error: `fetchExpectedForTask: ${err}` };
  }
}

// ─── Active task query ────────────────────────────────────────────────────────

export async function getActiveOpenStatementTask(
  storeId: number,
  date:    Date,
): Promise<OpenStatementTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [today] = await db
    .select()
    .from(openStatementTasks)
    .where(and(
      eq(openStatementTasks.storeId, storeId),
      gte(openStatementTasks.date, dayStart),
      lte(openStatementTasks.date, dayEnd),
      inArray(openStatementTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .orderBy(openStatementTasks.createdAt)
    .limit(1);
  if (today) return today;

  const [prior] = await db
    .select()
    .from(openStatementTasks)
    .where(and(
      eq(openStatementTasks.storeId, storeId),
      eq(openStatementTasks.status, 'discrepancy'),
      isNull(openStatementTasks.parentTaskId),
    ))
    .orderBy(openStatementTasks.createdAt)
    .limit(1);

  return prior ?? null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitOpenStatement(
  input: SubmitOpenStatementInput,
): Promise<TaskResult<OpenStatementTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    if (!input.actualAmount || !input.actualAmount.trim())
      return { success: false, error: 'Nominal Open Statement wajib diisi.' };
    const actualNum = Number(input.actualAmount);
    if (!isFinite(actualNum) || actualNum < 0)
      return { success: false, error: 'Nominal Open Statement harus angka ≥ 0.' };

    const [task] = await db
      .select()
      .from(openStatementTasks)
      .where(eq(openStatementTasks.scheduleId, input.scheduleId))
      .limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (['completed', 'verified', 'rejected'].includes(task.status ?? ''))
      return { success: false, error: 'Task sudah final.' };
    if (task.expectedAmount == null)
      return { success: false, error: 'Expected data belum di-fetch. Buka task ulang untuk fetch.' };

    const expectedNum = Number(task.expectedAmount);
    const isBalanced  = expectedNum === actualNum;
    const newStatus   = isBalanced ? 'completed' as const : 'discrepancy' as const;

    const now       = new Date();
    const eveningId = await getEveningShiftId();

    let discrepancyStartedAt       = task.discrepancyStartedAt;
    let discrepancyResolvedAt      = task.discrepancyResolvedAt;
    let discrepancyDurationMinutes = task.discrepancyDurationMinutes;

    if (!isBalanced && !discrepancyStartedAt) {
      discrepancyStartedAt = now;
    }
    if (isBalanced && discrepancyStartedAt && !discrepancyResolvedAt) {
      discrepancyResolvedAt      = now;
      discrepancyDurationMinutes = Math.max(0,
        Math.round((now.getTime() - new Date(discrepancyStartedAt).getTime()) / 60_000));
    }

    const [updated] = await db
      .update(openStatementTasks)
      .set({
        scheduleId:                 input.scheduleId,
        userId:                     input.userId,
        storeId:                    input.storeId,
        shiftId:                    eveningId,
        actualAmount:               input.actualAmount,
        isBalanced,
        status:                     newStatus,
        discrepancyStartedAt,
        discrepancyResolvedAt,
        discrepancyDurationMinutes,
        submittedLat:               String(input.geo.lat),
        submittedLng:               String(input.geo.lng),
        notes:                      input.notes,
        completedAt:                isBalanced ? now : null,
        updatedAt:                  now,
      })
      .where(eq(openStatementTasks.id, task.id))
      .returning();

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitOpenStatement: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export async function autoSaveOpenStatement(
  scheduleId: number,
  patch:      AutoSaveOpenStatementPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: openStatementTasks.id, status: openStatementTasks.status })
      .from(openStatementTasks)
      .where(eq(openStatementTasks.scheduleId, scheduleId))
      .limit(1);
    if (!existing) return { success: false, error: 'Task not found.' };
    if (['completed', 'verified', 'rejected'].includes(existing.status ?? ''))
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('actualAmount' in patch) update.actualAmount = patch.actualAmount;
    if ('notes'        in patch) update.notes        = patch.notes;
    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(openStatementTasks).set(update).where(eq(openStatementTasks.id, existing.id));
    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveOpenStatement: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getOpenStatementBySchedule(scheduleId: number): Promise<OpenStatementTask | null> {
  const [row] = await db
    .select()
    .from(openStatementTasks)
    .where(eq(openStatementTasks.scheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

export async function getOpenStatementById(id: number): Promise<OpenStatementTask | null> {
  const [row] = await db
    .select()
    .from(openStatementTasks)
    .where(eq(openStatementTasks.id, id))
    .limit(1);
  return row ?? null;
}

// ─── Materialise ──────────────────────────────────────────────────────────────

export async function materialiseOpenStatementTask(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [active] = await db
    .select({ id: openStatementTasks.id })
    .from(openStatementTasks)
    .where(and(
      eq(openStatementTasks.storeId, storeId),
      gte(openStatementTasks.date, dayStart),
      lte(openStatementTasks.date, dayEnd),
      inArray(openStatementTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .limit(1);
  if (active) return 'skipped';

  await db.insert(openStatementTasks).values({
    scheduleId,
    userId,
    storeId,
    shiftId,
    date:         dayStart,
    parentTaskId: null,
    status:       'pending',
  });

  return 'created';
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export async function verifyOpenStatement(input: {
  taskId: number; actorId: string; storeId: number; approve: boolean; notes?: string;
}): Promise<TaskResult<void>> {
  try {
    const { canManageSchedule } = await import('@/lib/schedule-utils');
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const [row] = await db
      .select({ id: openStatementTasks.id, status: openStatementTasks.status })
      .from(openStatementTasks)
      .where(eq(openStatementTasks.id, input.taskId))
      .limit(1);
    if (!row) return { success: false, error: 'Task tidak ditemukan.' };
    if (row.status !== 'completed')
      return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };

    await db
      .update(openStatementTasks)
      .set({
        status:     input.approve ? 'verified' : 'rejected',
        verifiedBy: input.actorId,
        verifiedAt: new Date(),
        notes:      input.notes,
        updatedAt:  new Date(),
      })
      .where(eq(openStatementTasks.id, input.taskId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyOpenStatement: ${err}` };
  }
}