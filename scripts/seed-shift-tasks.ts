// scripts/seed-shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds the Shift ↔ Task configuration.
//
// This script is intentionally idempotent:
// - refreshes task_definitions from TASK_CATALOG
// - refreshes shift_tasks from SHIFT_TASK_MAP
// - keeps existing shift IDs from the shifts lookup table
//
// Run after seed-setup.ts, because seed-setup creates the shifts:
//   npm run seed:shift-tasks
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';
import {
  SHIFT_TASK_MAP,
  TASK_CATALOG,
  type ShiftCode,
  type TaskType,
} from '@/lib/shift-tasks';

const DEFAULT_SHIFT_CODES = Object.keys(SHIFT_TASK_MAP) as ShiftCode[];

async function seedTaskDefinitions() {
  const codes = TASK_CATALOG.map((entry) => entry.code);

  const existingRows = codes.length
    ? await db
        .select({ id: taskDefinitions.id, code: taskDefinitions.code })
        .from(taskDefinitions)
        .where(inArray(taskDefinitions.code, codes))
    : [];

  const existingIdByCode = new Map(existingRows.map((row) => [row.code, row.id]));

  const toInsert = TASK_CATALOG.filter((entry) => !existingIdByCode.has(entry.code));
  const toUpdate = TASK_CATALOG.filter((entry) => existingIdByCode.has(entry.code));

  if (toInsert.length) {
    await db.insert(taskDefinitions).values(
      toInsert.map((entry) => ({
        code:        entry.code,
        label:       entry.label,
        description: entry.description ?? null,
        icon:        entry.icon,
        accent:      entry.accent,
        isPersonal:  entry.isPersonal,
        isActive:    true,
        sortOrder:   entry.sortOrder,
        updatedAt:   new Date(),
      })),
    );
  }

  // Small table; per-row updates are clearer and compatible with all Drizzle/Neon setups.
  for (const entry of toUpdate) {
    await db
      .update(taskDefinitions)
      .set({
        label:       entry.label,
        description: entry.description ?? null,
        icon:        entry.icon,
        accent:      entry.accent,
        isPersonal:  entry.isPersonal,
        isActive:    true,
        sortOrder:   entry.sortOrder,
        updatedAt:   new Date(),
      })
      .where(eq(taskDefinitions.id, existingIdByCode.get(entry.code)!));
  }

  const refreshedRows = await db
    .select({ id: taskDefinitions.id, code: taskDefinitions.code })
    .from(taskDefinitions)
    .where(inArray(taskDefinitions.code, codes));

  const taskDefinitionIdByCode = new Map<TaskType, number>();
  for (const row of refreshedRows) {
    taskDefinitionIdByCode.set(row.code as TaskType, row.id);
  }

  return {
    inserted: toInsert.length,
    updated:  toUpdate.length,
    total:    TASK_CATALOG.length,
    taskDefinitionIdByCode,
  };
}

async function seedShiftTaskAssignments(taskDefinitionIdByCode: Map<TaskType, number>) {
  const shiftRows = await db
    .select({ id: shifts.id, code: shifts.code, label: shifts.label })
    .from(shifts)
    .where(inArray(shifts.code, DEFAULT_SHIFT_CODES));

  const shiftByCode = new Map(shiftRows.map((shift) => [shift.code as ShiftCode, shift]));
  const missingShiftCodes = DEFAULT_SHIFT_CODES.filter((code) => !shiftByCode.has(code));

  if (missingShiftCodes.length) {
    throw new Error(
      `Missing shift lookup rows: ${missingShiftCodes.join(', ')}. Run scripts/seed-setup.ts first.`,
    );
  }

  const shiftIds = shiftRows.map((shift) => shift.id);

  const assignmentRows: Array<{
    shiftId: number;
    taskDefinitionId: number;
    isRequired: boolean;
    isActive: boolean;
    sortOrder: number;
    assignedBy: string | null;
    updatedAt: Date;
  }> = [];

  for (const shiftCode of DEFAULT_SHIFT_CODES) {
    const shift = shiftByCode.get(shiftCode)!;
    const taskCodes = SHIFT_TASK_MAP[shiftCode];

    taskCodes.forEach((taskCode, index) => {
      const taskDefinitionId = taskDefinitionIdByCode.get(taskCode);
      if (!taskDefinitionId) {
        throw new Error(`Missing task_definition for code "${taskCode}"`);
      }

      assignmentRows.push({
        shiftId:          shift.id,
        taskDefinitionId,
        isRequired:       true,
        isActive:         true,
        sortOrder:        (index + 1) * 10,
        assignedBy:       null,
        updatedAt:        new Date(),
      });
    });
  }

  // Neon HTTP driver does not support transactions.
  // This seeder is idempotent, so we do the refresh in two normal queries.
  // It only deletes mappings for the default seeded shifts, so custom admin-created
  // shifts are not touched.
  await db.delete(shiftTasks).where(inArray(shiftTasks.shiftId, shiftIds));

  if (assignmentRows.length) {
    await db.insert(shiftTasks).values(assignmentRows);
  }

  return {
    shifts: shiftRows.length,
    assignments: assignmentRows.length,
  };
}

async function main() {
  console.log('\n🌱 seed-shift-tasks: task_definitions + shift_tasks');

  const definitions = await seedTaskDefinitions();
  const assignments = await seedShiftTaskAssignments(definitions.taskDefinitionIdByCode);

  console.log(`\n✅ task_definitions: inserted ${definitions.inserted}, updated ${definitions.updated}, total ${definitions.total}`);
  console.log(`✅ shift_tasks: refreshed ${assignments.assignments} assignments across ${assignments.shifts} shifts`);

  console.log('\n📌 Current mapping:');
  for (const shiftCode of DEFAULT_SHIFT_CODES) {
    console.log(`   ${shiftCode.padEnd(8)} → ${SHIFT_TASK_MAP[shiftCode].join(', ')}`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 seed-shift-tasks failed:', err);
    process.exit(1);
  });
