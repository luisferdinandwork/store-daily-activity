import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { taskDefinitions } from '@/lib/db/schema';
import { TASK_CATALOG } from '@/lib/shift-tasks';

/** Read IT's current setting; use the catalog default only for a missing row. */
export async function taskRequiresLocation(code: string): Promise<boolean> {
  const [definition] = await db.select({ requiresLocation: taskDefinitions.requiresLocation })
    .from(taskDefinitions).where(eq(taskDefinitions.code, code)).limit(1);
  return definition?.requiresLocation ?? TASK_CATALOG.find((task) => task.code === code)?.requiresLocation ?? true;
}
