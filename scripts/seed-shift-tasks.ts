// scripts/seed-shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds the shift/task configuration:
//
//   1. task_definitions  — catalog of assignable task types (from TASK_CATALOG).
//   2. retire            — deactivate task types replaced by `store_closing`
//                          (edc_reconciliation, eod_z_report, open_statement),
//                          plus any shift_tasks rows still pointing at them.
//   3. shift_tasks       — default shift→task mapping (SHIFT_TASK_MAP).
//
// Idempotent: catalog rows are upserted by `code`; assignments are inserted only
// when the (shiftId, taskDefinitionId) pair doesn't already exist.
//
// Run with:  npm run seed:shift-tasks   (after npm run seed:setup)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';
import { TASK_CATALOG, SHIFT_TASK_MAP, REMOVED_TASK_TYPES } from '@/lib/shift-tasks';

// ── 1. Catalog ────────────────────────────────────────────────────────────────

export async function seedTaskDefinitions() {
  let inserted = 0;
  let updated = 0;

  for (const entry of TASK_CATALOG) {
    const existing = await db
      .select({ id: taskDefinitions.id })
      .from(taskDefinitions)
      .where(eq(taskDefinitions.code, entry.code))
      .limit(1);

    if (existing.length) {
      await db
        .update(taskDefinitions)
        .set({
          label:       entry.label,
          description: entry.description ?? null,
          icon:        entry.icon,
          accent:      entry.accent,
          isPersonal:  entry.isPersonal,
          sortOrder:   entry.sortOrder,
          isActive:    true, // re-activate if it had been retired previously
          updatedAt:   new Date(),
        })
        .where(eq(taskDefinitions.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(taskDefinitions).values({
        code:        entry.code,
        label:       entry.label,
        description: entry.description ?? null,
        icon:        entry.icon,
        accent:      entry.accent,
        isPersonal:  entry.isPersonal,
        sortOrder:   entry.sortOrder,
      });
      inserted += 1;
    }
  }

  return { inserted, updated, total: TASK_CATALOG.length };
}

// ── 2. Retire replaced task types ───────────────────────────────────────────

export async function retireRemovedTaskDefinitions() {
  const codes = [...REMOVED_TASK_TYPES];

  const removed = await db
    .select({ id: taskDefinitions.id })
    .from(taskDefinitions)
    .where(inArray(taskDefinitions.code, codes));

  if (!removed.length) return { deactivatedDefs: 0, deactivatedAssignments: 0 };

  const ids = removed.map((r) => r.id);

  await db
    .update(taskDefinitions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(taskDefinitions.id, ids));

  await db
    .update(shiftTasks)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(shiftTasks.taskDefinitionId, ids));

  return { deactivatedDefs: ids.length, deactivatedAssignments: ids.length };
}

// ── 3. Default assignments ──────────────────────────────────────────────────

export async function seedShiftTaskAssignments() {
  let inserted = 0;
  let reactivated = 0;
  let skipped = 0;
  const missingShifts: string[] = [];
  const missingTasks: string[] = [];

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode = new Map(shiftRows.map((s) => [s.code, s.id]));

  const defRows = await db
    .select({ id: taskDefinitions.id, code: taskDefinitions.code })
    .from(taskDefinitions);
  const defIdByCode = new Map(defRows.map((d) => [d.code, d.id]));

  for (const [shiftCode, codes] of Object.entries(SHIFT_TASK_MAP)) {
    const shiftId = shiftIdByCode.get(shiftCode);
    if (!shiftId) {
      missingShifts.push(shiftCode);
      continue;
    }

    let order = 0;
    for (const code of codes) {
      order += 10;
      const defId = defIdByCode.get(code);
      if (!defId) {
        if (!missingTasks.includes(code)) missingTasks.push(code);
        continue;
      }

      const existing = await db
        .select({ id: shiftTasks.id })
        .from(shiftTasks)
        .where(and(eq(shiftTasks.shiftId, shiftId), eq(shiftTasks.taskDefinitionId, defId)))
        .limit(1);

      if (existing.length) {
        // Make sure a default pairing is active (it may have been disabled).
        await db
          .update(shiftTasks)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(shiftTasks.id, existing[0].id));
        skipped += 1;
        reactivated += 1;
        continue;
      }

      await db.insert(shiftTasks).values({
        shiftId,
        taskDefinitionId: defId,
        isRequired: true,
        sortOrder: order,
      });
      inserted += 1;
    }
  }

  return { inserted, reactivated, skipped, missingShifts, missingTasks };
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  const cat = await seedTaskDefinitions();
  console.log(`✅ task_definitions — inserted ${cat.inserted}, updated ${cat.updated}`);

  const ret = await retireRemovedTaskDefinitions();
  if (ret.deactivatedDefs) {
    console.log(`🧹 retired ${ret.deactivatedDefs} replaced task type(s) → store_closing`);
  }

  const asg = await seedShiftTaskAssignments();
  console.log(`✅ shift_tasks       — inserted ${asg.inserted}, skipped ${asg.skipped}`);

  if (asg.missingShifts.length) {
    console.warn(`⚠️  Shifts not found (run "npm run seed:setup" first): ${asg.missingShifts.join(', ')}`);
  }
  if (asg.missingTasks.length) {
    console.warn(`⚠️  Task codes not in catalog: ${asg.missingTasks.join(', ')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 seed:shift-tasks failed:', err);
    process.exit(1);
  });