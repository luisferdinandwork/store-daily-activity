// lib/db/utils/shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolves which task types apply to a shift, from the shift_tasks config.
//
// `code` here is task_definitions.code, which equals the `task.type` used by
// the employee tasks API and seeder (e.g. 'store_opening', 'grooming').
//
// Both consumers (employee API, seed-tasks) treat an EMPTY result as "no config
// yet" and fall back to their original hardcoded rules, so nothing breaks before
// the shift-tasks seed step (`npm run db:seed`) has been run.
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shiftTasks, taskDefinitions } from '@/lib/db/schema';

/** Union of enabled task codes across the given shift ids. */
export async function getEnabledTaskCodesForShiftIds(
  shiftIds: number[],
): Promise<Set<string>> {
  const unique = [...new Set(shiftIds)].filter((n) => Number.isInteger(n));
  if (!unique.length) return new Set();

  const rows = await db
    .select({ code: taskDefinitions.code })
    .from(shiftTasks)
    .innerJoin(taskDefinitions, eq(taskDefinitions.id, shiftTasks.taskDefinitionId))
    .where(
      and(
        inArray(shiftTasks.shiftId, unique),
        eq(shiftTasks.isActive, true),
        eq(taskDefinitions.isActive, true),
      ),
    );

  return new Set(rows.map((r) => r.code));
}

/** Per-shift map { shiftId -> Set<taskCode> }, for callers that loop shifts. */
export async function getEnabledTaskCodesByShiftId(): Promise<Map<number, Set<string>>> {
  const rows = await db
    .select({ shiftId: shiftTasks.shiftId, code: taskDefinitions.code })
    .from(shiftTasks)
    .innerJoin(taskDefinitions, eq(taskDefinitions.id, shiftTasks.taskDefinitionId))
    .where(and(eq(shiftTasks.isActive, true), eq(taskDefinitions.isActive, true)));

  const map = new Map<number, Set<string>>();
  for (const r of rows) {
    const set = map.get(r.shiftId) ?? new Set<string>();
    set.add(r.code);
    map.set(r.shiftId, set);
  }
  return map;
}

/** True if any shift_tasks config exists at all. */
export async function hasAnyShiftTaskConfig(): Promise<boolean> {
  const [row] = await db.select({ id: shiftTasks.id }).from(shiftTasks).limit(1);
  return Boolean(row);
}