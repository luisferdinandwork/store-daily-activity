// lib/tasks/store-opening.ts
import { z } from 'zod';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { storeOpeningTasks } from '@/lib/db/schema';
import type { NewStoreOpeningTask, StoreOpeningTask } from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────
export const STORE_OPENING_PHOTO_LIMITS = {
  storeFront: { min: 1, max: 3 },
  cashDrawer: { min: 1, max: 2 },
} as const;

// ─── Zod Schema (fixed — no customisation possible) ───────────────────────────
export const storeOpeningSubmitSchema = z.object({
  cashDrawerAmount: z
    .number({ message: 'Cash drawer amount is required' })
    .int()
    .min(0, 'Amount must be 0 or more'),
  allLightsOn:      z.boolean({ message: 'Lights check is required' }),
  cleanlinessCheck: z.boolean({ message: 'Cleanliness check is required' }),
  equipmentCheck:   z.boolean({ message: 'Equipment check is required' }),
  stockCheck:       z.boolean({ message: 'Stock check is required' }),
  safetyCheck:      z.boolean({ message: 'Safety check is required' }),
  openingNotes:     z.string().max(1000).optional(),

  storeFrontPhotos: z
    .array(z.string().url('Each photo must be a valid URL'))
    .min(STORE_OPENING_PHOTO_LIMITS.storeFront.min, 'At least 1 store-front photo is required')
    .max(STORE_OPENING_PHOTO_LIMITS.storeFront.max, `Maximum ${STORE_OPENING_PHOTO_LIMITS.storeFront.max} store-front photos`),

  cashDrawerPhotos: z
    .array(z.string().url('Each photo must be a valid URL'))
    .min(STORE_OPENING_PHOTO_LIMITS.cashDrawer.min, 'At least 1 cash drawer photo is required')
    .max(STORE_OPENING_PHOTO_LIMITS.cashDrawer.max, `Maximum ${STORE_OPENING_PHOTO_LIMITS.cashDrawer.max} cash drawer photos`),
});

export type StoreOpeningSubmitInput = z.infer<typeof storeOpeningSubmitSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toJson = (arr: string[]): string => JSON.stringify(arr);

export const parsePhotos = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
};

// ─── DB Utilities ─────────────────────────────────────────────────────────────

/** Create a pending row — call when a shift starts or attendance is recorded. */
export async function createStoreOpeningTask(
  data: Pick<NewStoreOpeningTask, 'userId' | 'storeId' | 'date' | 'shift' | 'scheduleId' | 'attendanceId'>
): Promise<StoreOpeningTask> {
  const [row] = await db
    .insert(storeOpeningTasks)
    .values({ ...data, status: 'pending' })
    .returning();
  return row;
}

/** Look up by attendance ID. Returns null if not yet created. */
export async function getStoreOpeningTaskByAttendance(
  attendanceId: string
): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.attendanceId, attendanceId))
    .limit(1);
  return row ?? null;
}

/** All Store Opening tasks for a store on a given calendar date. */
export async function getStoreOpeningTasksByDate(
  storeId: string,
  date: Date
): Promise<StoreOpeningTask[]> {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);

  return db
    .select()
    .from(storeOpeningTasks)
    .where(
      and(
        eq(storeOpeningTasks.storeId, storeId),
        gte(storeOpeningTasks.date, start),
        lte(storeOpeningTasks.date, end),
      )
    );
}

/**
 * Submit the task. Validates with Zod (throws ZodError on failure),
 * then marks status → 'completed'.
 */
export async function submitStoreOpeningTask(
  taskId: string,
  input: StoreOpeningSubmitInput
): Promise<StoreOpeningTask> {
  const data = storeOpeningSubmitSchema.parse(input);

  const [updated] = await db
    .update(storeOpeningTasks)
    .set({
      cashDrawerAmount: data.cashDrawerAmount,
      allLightsOn:      data.allLightsOn,
      cleanlinessCheck: data.cleanlinessCheck,
      equipmentCheck:   data.equipmentCheck,
      stockCheck:       data.stockCheck,
      safetyCheck:      data.safetyCheck,
      openingNotes:     data.openingNotes ?? null,
      storeFrontPhotos: toJson(data.storeFrontPhotos),
      cashDrawerPhotos: toJson(data.cashDrawerPhotos),
      status:           'completed',
      completedAt:      new Date(),
      updatedAt:        new Date(),
    })
    .where(eq(storeOpeningTasks.id, taskId))
    .returning();

  return updated;
}

/** Stamp verifiedBy + verifiedAt — called by PIC or OPS. */
export async function verifyStoreOpeningTask(
  taskId: string,
  verifiedBy: string
): Promise<StoreOpeningTask> {
  const [updated] = await db
    .update(storeOpeningTasks)
    .set({ verifiedBy, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(storeOpeningTasks.id, taskId))
    .returning();
  return updated;
}

/** Deserialise photo URL columns from a task row. */
export function parseStoreOpeningPhotos(task: StoreOpeningTask) {
  return {
    storeFrontPhotos: parsePhotos(task.storeFrontPhotos),
    cashDrawerPhotos: parsePhotos(task.cashDrawerPhotos),
  };
}

/** Returns individual check statuses + an allPassed flag. */
export function getStoreOpeningChecklistStatus(task: StoreOpeningTask) {
  const checks = {
    allLightsOn:      task.allLightsOn      ?? false,
    cleanlinessCheck: task.cleanlinessCheck ?? false,
    equipmentCheck:   task.equipmentCheck   ?? false,
    stockCheck:       task.stockCheck       ?? false,
    safetyCheck:      task.safetyCheck      ?? false,
  };
  return {
    ...checks,
    allPassed: Object.values(checks).every(Boolean),
  };
}