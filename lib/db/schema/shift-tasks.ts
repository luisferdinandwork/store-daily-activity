// lib/db/schema/shift-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shift ↔ Task configuration.
//
// `shifts` (lookups.ts) already describes a shift's hours, accent, icon and
// meal breaks. This file adds the missing piece: which TASK TYPES are expected
// during each shift.
//
//   task_definitions   — admin-managed catalog of assignable task types. Each
//                        `code` matches the `task.type` used elsewhere in the
//                        app (e.g. 'store_front', 'grooming'), so an assignment
//                        maps directly onto the per-type tables in tasks.ts.
//
//   shift_tasks        — join table. One row = "this task type is part of this
//                        shift". Soft-disable with isActive; never hard-delete a
//                        shift that historical task rows still reference.
//
// Mirrors the lookup conventions in lookups.ts (code/label/isActive/sortOrder)
// and the join-table conventions in tasks.ts (unique pair + index).
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

import { shifts } from './lookups';
import { users } from './core';

// ─── Task catalog ───────────────────────────────────────────────────────────

export const taskDefinitions = pgTable('task_definitions', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),   // stable; matches task.type
  label:       text('label').notNull(),
  description: text('description'),

  // Display hints (parallel to shifts.accent / shifts.icon).
  icon:        text('icon'),                       // lucide glyph name | null
  accent:      text('accent'),                     // PaletteKey | null

  // grooming-style tasks are tracked per-employee rather than per-store.
  isPersonal:  boolean('is_personal').default(false).notNull(),

  // Whether employees must grant/verify location to work on this task type.
  // OPS-configurable — see app/ops/tasks/settings and /api/ops/task-definitions.
  requiresLocation: boolean('requires_location').default(true).notNull(),

  isActive:    boolean('is_active').default(true).notNull(),
  sortOrder:   integer('sort_order').default(0).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  activeIdx: index('task_definitions_active_idx').on(t.isActive),
}));

// ─── Shift ↔ Task assignments ─────────────────────────────────────────────────

export const shiftTasks = pgTable('shift_tasks', {
  id:      serial('id').primaryKey(),

  shiftId: integer('shift_id')
    .references(() => shifts.id, { onDelete: 'cascade' })
    .notNull(),

  taskDefinitionId: integer('task_definition_id')
    .references(() => taskDefinitions.id, { onDelete: 'cascade' })
    .notNull(),

  // Required vs optional within the shift — whether this task assignment is
  // mandatory for the shift at all. Independent from isSequenced below.
  isRequired: boolean('is_required').default(true).notNull(),

  // Whether this task is part of the shift's FIXED, GATED order: sequenced
  // tasks must be done one after another (sortOrder decides the sequence,
  // managed from OPS → Shift & Tasks → Fixed Order) and each one is locked
  // for employees until the previous sequenced task is completed/verified.
  // Tasks with isSequenced = false are "Anytime" tasks: never locked, and
  // always shown below the sequenced ones (still using sortOrder to order
  // themselves relative to each other).
  isSequenced: boolean('is_sequenced').default(false).notNull(),

  isActive:   boolean('is_active').default(true).notNull(),
  sortOrder:  integer('sort_order').default(0).notNull(),

  assignedBy: text('assigned_by').references(() => users.id),

  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // A task type can only be attached to a shift once.
  uniqShiftTask: unique('shift_tasks_shift_task_unique').on(t.shiftId, t.taskDefinitionId),
  shiftIdx:      index('shift_tasks_shift_idx').on(t.shiftId),
  taskDefIdx:    index('shift_tasks_task_def_idx').on(t.taskDefinitionId),
}));

// ─── Inferred types ───────────────────────────────────────────────────────────

export type TaskDefinition    = typeof taskDefinitions.$inferSelect;
export type NewTaskDefinition = typeof taskDefinitions.$inferInsert;
export type ShiftTask         = typeof shiftTasks.$inferSelect;
export type NewShiftTask      = typeof shiftTasks.$inferInsert;