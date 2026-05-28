// lib/db/utils/open-statement.ts
// ─────────────────────────────────────────────────────────────────────────────
// Open Statement task.
// New workflow:
//   • Employee chooses DONE or ON HOLD.
//   • DONE      → task is completed immediately.
//   • ON HOLD   → current task is completed with isOnHold=true, then the next
//                 morning materialisation creates a carry-over task that must
//                 be completed by the morning shift employee.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, lt, desc } from 'drizzle-orm';
import {
  openStatementTasks, stores, shifts, attendance,
  type OpenStatementTask,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export type OpenStatementDecision = 'done' | 'hold';

export interface SubmitOpenStatementInput {
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

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

    const [task] = await db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, input.scheduleId)).limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah final.' };

    const now = new Date();
    const isHold = input.decision === 'hold';

    const [updated] = await db.update(openStatementTasks).set({
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
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

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitOpenStatement: ${err}` };
  }
}

export async function autoSaveOpenStatement(scheduleId: number, patch: AutoSaveOpenStatementPatch): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db.select({ id: openStatementTasks.id, status: openStatementTasks.status }).from(openStatementTasks).where(eq(openStatementTasks.scheduleId, scheduleId)).limit(1);
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

export async function materialiseOpenStatementTask(scheduleId: number, userId: string, storeId: number, shiftId: number, date: Date): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const shiftCode = await getShiftCode(shiftId);

  const [today] = await db.select({ id: openStatementTasks.id }).from(openStatementTasks).where(and(
    eq(openStatementTasks.storeId, storeId),
    gte(openStatementTasks.date, dayStart),
    lte(openStatementTasks.date, dayEnd),
    inArray(openStatementTasks.status, ['pending', 'in_progress']),
  )).limit(1);
  if (today) return 'skipped';

  // Morning task is only created when yesterday/prior evening was put on hold.
  if (shiftCode === 'morning' || shiftCode === 'full_day') {
    const [held] = await db.select().from(openStatementTasks).where(and(
      eq(openStatementTasks.storeId, storeId),
      eq(openStatementTasks.isOnHold, true),
      lt(openStatementTasks.date, dayStart),
      isNull(openStatementTasks.parentTaskId),
    )).orderBy(desc(openStatementTasks.date), desc(openStatementTasks.createdAt)).limit(1);

    if (held) {
      const [existingCarry] = await db.select({ id: openStatementTasks.id }).from(openStatementTasks).where(and(
        eq(openStatementTasks.parentTaskId, held.id),
        gte(openStatementTasks.date, dayStart),
        lte(openStatementTasks.date, dayEnd),
      )).limit(1);
      if (existingCarry) return 'skipped';

      await db.insert(openStatementTasks).values({
        scheduleId, userId, storeId, shiftId, date: dayStart,
        parentTaskId: held.id,
        status: 'pending',
        notes: held.holdReason ? `Carry-over dari Open Statement sebelumnya: ${held.holdReason}` : 'Carry-over dari Open Statement sebelumnya.',
      });
      return 'created';
    }

    if (shiftCode === 'morning') return 'skipped';
  }

  // Normal Open Statement is still an evening task.
  if (shiftCode !== 'evening' && shiftCode !== 'full_day') return 'skipped';

  await db.insert(openStatementTasks).values({
    scheduleId, userId, storeId, shiftId, date: dayStart,
    parentTaskId: null,
    status: 'pending',
  });

  return 'created';
}
