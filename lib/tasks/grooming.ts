// lib/tasks/grooming.ts
import { z } from 'zod';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groomingTasks } from '@/lib/db/schema';
import type { NewGroomingTask, GroomingTask } from '@/lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────
export const GROOMING_PHOTO_LIMITS = {
  selfie: { min: 1, max: 2 },
} as const;

// ─── Zod Schema (fixed — no customisation possible) ───────────────────────────
export const groomingSubmitSchema = z.object({
  uniformComplete:      z.boolean({ message: 'Uniform check is required' }),
  hairGroomed:          z.boolean({ message: 'Hair check is required' }),
  nailsClean:           z.boolean({ message: 'Nails check is required' }),
  accessoriesCompliant: z.boolean({ message: 'Accessories check is required' }),
  shoeCompliant:        z.boolean({ message: 'Shoe check is required' }),
  groomingNotes:        z.string().max(500).optional(),

  selfiePhotos: z
    .array(z.string().url('Each photo must be a valid URL'))
    .min(GROOMING_PHOTO_LIMITS.selfie.min, 'At least 1 selfie photo is required')
    .max(GROOMING_PHOTO_LIMITS.selfie.max, `Maximum ${GROOMING_PHOTO_LIMITS.selfie.max} selfie photos`),
});

export type GroomingSubmitInput = z.infer<typeof groomingSubmitSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toJson = (arr: string[]): string => JSON.stringify(arr);

export const parsePhotos = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
};

// ─── DB Utilities ─────────────────────────────────────────────────────────────

/** Create a pending row — one per employee per shift. */
export async function createGroomingTask(
  data: Pick<NewGroomingTask, 'userId' | 'storeId' | 'date' | 'shift' | 'scheduleId' | 'attendanceId'>
): Promise<GroomingTask> {
  const [row] = await db
    .insert(groomingTasks)
    .values({ ...data, status: 'pending' })
    .returning();
  return row;
}

/** Look up by attendance ID. Returns null if not yet created. */
export async function getGroomingTaskByAttendance(
  attendanceId: string
): Promise<GroomingTask | null> {
  const [row] = await db
    .select()
    .from(groomingTasks)
    .where(eq(groomingTasks.attendanceId, attendanceId))
    .limit(1);
  return row ?? null;
}

/** All Grooming tasks for a store on a given calendar date. */
export async function getGroomingTasksByDate(
  storeId: string,
  date: Date
): Promise<GroomingTask[]> {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);

  return db
    .select()
    .from(groomingTasks)
    .where(
      and(
        eq(groomingTasks.storeId, storeId),
        gte(groomingTasks.date, start),
        lte(groomingTasks.date, end),
      )
    );
}

/** All Grooming tasks for a specific user (e.g. history view). */
export async function getGroomingTasksByUser(userId: string): Promise<GroomingTask[]> {
  return db
    .select()
    .from(groomingTasks)
    .where(eq(groomingTasks.userId, userId));
}

/**
 * Submit the task. Validates with Zod (throws ZodError on failure),
 * then marks status → 'completed'.
 */
export async function submitGroomingTask(
  taskId: string,
  input: GroomingSubmitInput
): Promise<GroomingTask> {
  const data = groomingSubmitSchema.parse(input);

  const [updated] = await db
    .update(groomingTasks)
    .set({
      uniformComplete:      data.uniformComplete,
      hairGroomed:          data.hairGroomed,
      nailsClean:           data.nailsClean,
      accessoriesCompliant: data.accessoriesCompliant,
      shoeCompliant:        data.shoeCompliant,
      groomingNotes:        data.groomingNotes ?? null,
      selfiePhotos:         toJson(data.selfiePhotos),
      status:               'completed',
      completedAt:          new Date(),
      updatedAt:            new Date(),
    })
    .where(eq(groomingTasks.id, taskId))
    .returning();

  return updated;
}

/** Stamp verifiedBy + verifiedAt — called by PIC or OPS. */
export async function verifyGroomingTask(
  taskId: string,
  verifiedBy: string
): Promise<GroomingTask> {
  const [updated] = await db
    .update(groomingTasks)
    .set({ verifiedBy, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(groomingTasks.id, taskId))
    .returning();
  return updated;
}

/** Deserialise selfie URLs from a task row. */
export function parseGroomingPhotos(task: GroomingTask) {
  return {
    selfiePhotos: parsePhotos(task.selfiePhotos),
  };
}

/** Returns individual check statuses + allPassed flag + list of failed checks. */
export function getGroomingChecklistStatus(task: GroomingTask) {
  const checks = {
    uniformComplete:      task.uniformComplete      ?? false,
    hairGroomed:          task.hairGroomed          ?? false,
    nailsClean:           task.nailsClean           ?? false,
    accessoriesCompliant: task.accessoriesCompliant ?? false,
    shoeCompliant:        task.shoeCompliant        ?? false,
  };
  return {
    ...checks,
    allPassed:    Object.values(checks).every(Boolean),
    failedChecks: (Object.entries(checks) as [string, boolean][])
      .filter(([, v]) => !v)
      .map(([k]) => k),
  };
}