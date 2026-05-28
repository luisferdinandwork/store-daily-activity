// lib/db/utils/shared-daily-morning-task.ts
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { shifts } from '@/lib/db/schema';

let morningShiftIdCache: number | null = null;

/**
 * These tasks are generated from both morning/evening/full_day schedules in some flows,
 * but they should behave as ONE shared daily store task shown under morning only.
 */
export async function getMorningShiftId(): Promise<number> {
  if (morningShiftIdCache != null) return morningShiftIdCache;

  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, 'morning'))
    .limit(1);

  if (!row) throw new Error('Morning shift not found in shifts table.');

  morningShiftIdCache = row.id;
  return row.id;
}
