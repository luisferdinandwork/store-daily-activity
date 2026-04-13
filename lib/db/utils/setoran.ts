// lib/db/utils/setoran.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the Setoran task.
//
// Setoran is a SHARED morning task — one row per (storeId, date). Any employee
// scheduled on the morning/full_day shift for that store can fill it out.
//
// Fields required to submit:
//   • amount       — nominal setoran (numeric string)
//   • linkSetoran  — reference link / transfer number
//   • resiPhoto    — exactly one photo (stored as a single URL, not JSON)
//
// Access rules:
//   • Employee must be checked in (attendance row for this schedule).
//   • NO geofence check — setoran can be submitted from anywhere as long as
//     the employee has clocked in for their shift.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  setoranTasks, shifts, attendance,
  type SetoranTask,
} from '@/lib/db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface SubmitSetoranInput {
  scheduleId:  number;
  userId:      string;
  storeId:     number;
  amount:      string;
  linkSetoran: string;
  /** Single photo URL (not an array). */
  resiPhoto:   string;
  notes?:      string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

let _morningShiftIdCache: number | null = null;
async function getMorningShiftId(): Promise<number> {
  if (_morningShiftIdCache != null) return _morningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'morning')).limit(1);
  if (!row) throw new Error('Morning shift not found in shifts table.');
  _morningShiftIdCache = row.id;
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

// ─── Validation ───────────────────────────────────────────────────────────────

function validateSetoranPayload(input: SubmitSetoranInput): string | null {
  if (!input.amount || !input.amount.trim())      return 'Nominal setoran wajib diisi.';
  const numeric = Number(input.amount);
  if (!isFinite(numeric) || numeric <= 0)         return 'Nominal setoran harus angka positif.';

  if (!input.linkSetoran || !input.linkSetoran.trim())
    return 'Link / nomor referensi setoran wajib diisi.';

  if (!input.resiPhoto || !input.resiPhoto.trim())
    return 'Foto resi wajib diupload.';

  return null;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitSetoran(
  input: SubmitSetoranInput,
): Promise<TaskResult<SetoranTask>> {
  try {
    // Only check-in is required — no geofence.
    const checkInErr = await assertCheckedIn(input.scheduleId);
    if (checkInErr) return { success: false, error: checkInErr };

    const validationErr = validateSetoranPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const [existing] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Setoran sudah diverifikasi.' };

    const morningShiftId = await getMorningShiftId();
    const now            = new Date();

    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shiftId:      morningShiftId,
      date:         startOfDay(now),
      amount:       input.amount,
      linkSetoran:  input.linkSetoran,
      resiPhoto:    input.resiPhoto,
      // Geo columns are left null since setoran doesn't record location.
      submittedLat: null,
      submittedLng: null,
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(setoranTasks).set(values).where(eq(setoranTasks.id, existing.id)).returning())[0]
      : (await db.insert(setoranTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitSetoran: ${err}` };
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export interface SetoranAutoSavePatch {
  amount?:      string;
  linkSetoran?: string;
  resiPhoto?:   string | null;
  notes?:       string;
}

export async function autoSaveSetoran(
  scheduleId: number,
  patch:      SetoranAutoSavePatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: setoranTasks.id, status: setoranTasks.status })
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, scheduleId))
      .limit(1);

    if (!existing) return { success: false, error: 'Setoran task not found.' };
    if (existing.status === 'completed' || existing.status === 'verified')
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ('amount'      in patch) update.amount      = patch.amount;
    if ('linkSetoran' in patch) update.linkSetoran = patch.linkSetoran;
    if ('resiPhoto'   in patch) update.resiPhoto   = patch.resiPhoto ?? null;
    if ('notes'       in patch) update.notes       = patch.notes;

    if (existing.status === 'pending') update.status = 'in_progress';

    await db
      .update(setoranTasks)
      .set(update)
      .where(eq(setoranTasks.id, existing.id));

    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
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