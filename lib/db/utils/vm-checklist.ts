// lib/db/utils/vm-checklist.ts
import type { GeoPoint } from '@/lib/geo';
import { assertInGeofence } from '@/lib/db/utils/geofence';
import { db } from '@/lib/db';
import { taskShiftIdFor } from '@/lib/db/utils/shift-lookup';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  attendance,
  stores,
  vmChecklistTasks,
  type VmChecklistTask,
} from '@/lib/db/schema';

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type { GeoPoint };

export interface SubmitVmChecklistInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;

  shoeLaceShoeFillerPriceTagHangtagLabelK3L: boolean;
  lastPairAndPigskinHangtag: boolean;
  popPromoUpdate: boolean;
  displayTableWallShelvingShowcaseHangbarStackingPedestal: boolean;
  floorDisplayCleanliness: boolean;
  vmToolsStorage: boolean;

  notes?: string;
  skipGeo?: boolean;
}

export type AutoSaveVmChecklistInput = Partial<
  Pick<
    SubmitVmChecklistInput,
    | 'shoeLaceShoeFillerPriceTagHangtagLabelK3L'
    | 'lastPairAndPigskinHangtag'
    | 'popPromoUpdate'
    | 'displayTableWallShelvingShowcaseHangbarStackingPedestal'
    | 'floorDisplayCleanliness'
    | 'vmToolsStorage'
    | 'notes'
  >
>;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (!att?.checkInTime) {
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  }

  return null;
}

async function findByScheduleId(scheduleId: number): Promise<VmChecklistTask | null> {
  const [row] = await db
    .select()
    .from(vmChecklistTasks)
    .where(eq(vmChecklistTasks.scheduleId, scheduleId))
    .limit(1);

  return row ?? null;
}

async function findByStoreDate(storeId: number, date: Date): Promise<VmChecklistTask | null> {
  const [row] = await db
    .select()
    .from(vmChecklistTasks)
    .where(
      and(
        eq(vmChecklistTasks.storeId, storeId),
        gte(vmChecklistTasks.date, startOfDay(date)),
        lte(vmChecklistTasks.date, endOfDay(date)),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function assertCanProgressTask(
  scheduleId: number,
  storeId: number,
  geo: GeoPoint,
  skipGeo?: boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;

  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }

  return null;
}

export async function getOrCreateVmChecklistForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  rawShiftId: number,
  date: Date,
): Promise<TaskResult<VmChecklistTask>> {
  // JKP shifts work their base shift's store-level row (JP → morning, JS → evening).
  const shiftId = await taskShiftIdFor(rawShiftId);
  try {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    const [existing] = await db
      .select()
      .from(vmChecklistTasks)
      .where(
        and(
          eq(vmChecklistTasks.storeId, storeId),
          gte(vmChecklistTasks.date, dayStart),
          lte(vmChecklistTasks.date, dayEnd),
        ),
      )
      .limit(1);

    if (existing) return { success: true, data: existing };

    const [row] = await db
      .insert(vmChecklistTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId,
        date: dayStart,
        status: 'not_started',
      })
      .returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `getOrCreateVmChecklistForSchedule: ${err}` };
  }
}

export async function getVmChecklistById(id: number): Promise<VmChecklistTask | null> {
  const [row] = await db
    .select()
    .from(vmChecklistTasks)
    .where(eq(vmChecklistTasks.id, id))
    .limit(1);

  return row ?? null;
}

export async function autoSaveVmChecklist(
  taskId: number,
  patch: AutoSaveVmChecklistInput,
): Promise<TaskResult<VmChecklistTask>> {
  try {
    const cleanPatch: Partial<typeof vmChecklistTasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof patch.shoeLaceShoeFillerPriceTagHangtagLabelK3L === 'boolean') {
      cleanPatch.shoeLaceShoeFillerPriceTagHangtagLabelK3L =
        patch.shoeLaceShoeFillerPriceTagHangtagLabelK3L;
    }

    if (typeof patch.lastPairAndPigskinHangtag === 'boolean') {
      cleanPatch.lastPairAndPigskinHangtag = patch.lastPairAndPigskinHangtag;
    }

    if (typeof patch.popPromoUpdate === 'boolean') {
      cleanPatch.popPromoUpdate = patch.popPromoUpdate;
    }

    if (typeof patch.displayTableWallShelvingShowcaseHangbarStackingPedestal === 'boolean') {
      cleanPatch.displayTableWallShelvingShowcaseHangbarStackingPedestal =
        patch.displayTableWallShelvingShowcaseHangbarStackingPedestal;
    }

    if (typeof patch.floorDisplayCleanliness === 'boolean') {
      cleanPatch.floorDisplayCleanliness = patch.floorDisplayCleanliness;
    }

    if (typeof patch.vmToolsStorage === 'boolean') {
      cleanPatch.vmToolsStorage = patch.vmToolsStorage;
    }

    if (typeof patch.notes === 'string') {
      cleanPatch.notes = patch.notes;
    }

    const [row] = await db
      .update(vmChecklistTasks)
      .set(cleanPatch)
      .where(eq(vmChecklistTasks.id, taskId))
      .returning();

    if (!row) return { success: false, error: 'VM Checklist task tidak ditemukan.' };

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `autoSaveVmChecklist: ${err}` };
  }
}

export async function submitVmChecklist(
  input: SubmitVmChecklistInput,
): Promise<TaskResult<VmChecklistTask>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );

    if (gateErr) return { success: false, error: gateErr };

    // VM Checklist is a store-shared task — whoever created the row via
    // getOrCreateVmChecklistForSchedule may not be the same person who ends
    // up submitting it, so a scheduleId-only lookup can miss the existing
    // row and insert a duplicate. Fall back to store+date, same as the
    // sibling shared-task submit functions (e.g. submitMarketingCheck).
    const existing =
      (await findByScheduleId(input.scheduleId)) ??
      (await findByStoreDate(input.storeId, new Date()));

    if (existing?.status === 'completed') {
      return { success: false, error: 'VM Checklist task sudah selesai.' };
    }

    const now = new Date();
    const values = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: existing?.shiftId ?? 1,
      date: existing?.date ?? startOfDay(now),

      shoeLaceShoeFillerPriceTagHangtagLabelK3L:
        input.shoeLaceShoeFillerPriceTagHangtagLabelK3L,
      lastPairAndPigskinHangtag: input.lastPairAndPigskinHangtag,
      popPromoUpdate: input.popPromoUpdate,
      displayTableWallShelvingShowcaseHangbarStackingPedestal:
        input.displayTableWallShelvingShowcaseHangbarStackingPedestal,
      floorDisplayCleanliness: input.floorDisplayCleanliness,
      vmToolsStorage: input.vmToolsStorage,

      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
    };

    const [row] = existing
      ? await db
          .update(vmChecklistTasks)
          .set(values)
          .where(eq(vmChecklistTasks.id, existing.id))
          .returning()
      : await db.insert(vmChecklistTasks).values(values).returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitVmChecklist: ${err}` };
  }
}
