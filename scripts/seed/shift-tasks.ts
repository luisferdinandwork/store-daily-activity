// scripts/seed/shift-tasks.ts
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
// Run as part of `npm run db:seed` (after setup) — see scripts/seed/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shifts, shiftTasks, taskDefinitions } from '@/lib/db/schema';
import {
  TASK_CATALOG,
  SHIFT_TASK_MAP,
  REMOVED_TASK_TYPES,
  DEFAULT_SEQUENCED_TASK_TYPES,
  type ShiftCode,
} from '@/lib/shift-tasks';

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
      // requiresLocation seeds the initial default only — once a row exists,
      // OPS owns that field via /api/ops/task-definitions, so re-running this
      // seed must not clobber an OPS override (see the update() branch above).
      await db.insert(taskDefinitions).values({
        code:        entry.code,
        label:       entry.label,
        description: entry.description ?? null,
        icon:        entry.icon,
        accent:      entry.accent,
        isPersonal:  entry.isPersonal,
        sortOrder:   entry.sortOrder,
        requiresLocation: entry.requiresLocation,
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
  let pruned = 0;
  const prunedPairs: string[] = [];
  const missingShifts: string[] = [];
  const missingTasks: string[] = [];

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode = new Map(shiftRows.map((s) => [s.code, s.id]));
  const shiftCodeById = new Map(shiftRows.map((s) => [s.id, s.code]));

  const defRows = await db
    .select({ id: taskDefinitions.id, code: taskDefinitions.code })
    .from(taskDefinitions);
  const defIdByCode = new Map(defRows.map((d) => [d.code, d.id]));
  const defCodeById = new Map(defRows.map((d) => [d.id, d.code]));

  // Every (shiftId, taskDefinitionId) pair that SHIFT_TASK_MAP wants active.
  const desiredPairs = new Set<string>();

  for (const [shiftCode, codes] of Object.entries(SHIFT_TASK_MAP)) {
    const shiftId = shiftIdByCode.get(shiftCode);
    if (!shiftId) {
      missingShifts.push(shiftCode);
      continue;
    }

    const sequencedForShift = DEFAULT_SEQUENCED_TASK_TYPES[shiftCode as ShiftCode] ?? [];

    let order = 0;
    for (const code of codes) {
      order += 10;
      const defId = defIdByCode.get(code);
      if (!defId) {
        if (!missingTasks.includes(code)) missingTasks.push(code);
        continue;
      }

      desiredPairs.add(`${shiftId}:${defId}`);

      const existing = await db
        .select({ id: shiftTasks.id })
        .from(shiftTasks)
        .where(and(eq(shiftTasks.shiftId, shiftId), eq(shiftTasks.taskDefinitionId, defId)))
        .limit(1);

      if (existing.length) {
        // Re-sync the default ordering + make sure the pairing is active (it
        // may have been disabled). `isRequired` and `isSequenced` are
        // intentionally left alone — both are IT-owned via OPS → Shift &
        // Tasks ("Manage tasks" / "Fixed Order") and must not be clobbered
        // by re-running this seed.
        await db
          .update(shiftTasks)
          .set({ sortOrder: order, isActive: true, updatedAt: new Date() })
          .where(eq(shiftTasks.id, existing[0].id));
        skipped += 1;
        reactivated += 1;
        continue;
      }

      await db.insert(shiftTasks).values({
        shiftId,
        taskDefinitionId: defId,
        isRequired: true,
        isSequenced: sequencedForShift.includes(code),
        sortOrder: order,
      });
      inserted += 1;
    }
  }

  // Prune drift: deactivate any still-active assignment that SHIFT_TASK_MAP no
  // longer lists for that shift. Without this the seed only ever grows the
  // config, so an evening shift that once had morning task types would keep
  // leaking them into the employee task list. (Task types removed wholesale —
  // REMOVED_TASK_TYPES — are handled separately by retireRemovedTaskDefinitions.)
  const activeRows = await db
    .select({ id: shiftTasks.id, shiftId: shiftTasks.shiftId, defId: shiftTasks.taskDefinitionId })
    .from(shiftTasks)
    .where(eq(shiftTasks.isActive, true));

  const staleIds = activeRows
    .filter((r) => !desiredPairs.has(`${r.shiftId}:${r.defId}`))
    .map((r) => {
      prunedPairs.push(
        `${shiftCodeById.get(r.shiftId) ?? r.shiftId}/${defCodeById.get(r.defId) ?? r.defId}`,
      );
      return r.id;
    });

  if (staleIds.length) {
    await db
      .update(shiftTasks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(inArray(shiftTasks.id, staleIds));
    pruned = staleIds.length;
  }

  return { inserted, reactivated, skipped, pruned, prunedPairs, missingShifts, missingTasks };
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function seedShiftTasks() {
  const cat = await seedTaskDefinitions();
  console.log(`✅ task_definitions — inserted ${cat.inserted}, updated ${cat.updated}`);

  const ret = await retireRemovedTaskDefinitions();
  if (ret.deactivatedDefs) {
    console.log(`🧹 retired ${ret.deactivatedDefs} replaced task type(s) → store_closing`);
  }

  const asg = await seedShiftTaskAssignments();
  console.log(`✅ shift_tasks       — inserted ${asg.inserted}, skipped ${asg.skipped}`);

  if (asg.pruned) {
    console.log(
      `🧹 deactivated ${asg.pruned} drifted shift_task assignment(s): ${asg.prunedPairs.join(', ')}`,
    );
  }

  if (asg.missingShifts.length) {
    console.warn(`⚠️  Shifts not found (run the setup seed step first): ${asg.missingShifts.join(', ')}`);
  }
  if (asg.missingTasks.length) {
    console.warn(`⚠️  Task codes not in catalog: ${asg.missingTasks.join(', ')}`);
  }
}