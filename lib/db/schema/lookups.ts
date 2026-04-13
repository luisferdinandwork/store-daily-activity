// lib/db/schema/lookups.ts
// ─────────────────────────────────────────────────────────────────────────────
// Admin-managed lookup tables.
// These replace what used to be Postgres enums for:
//   • user roles         (was userRoleEnum)
//   • employee types     (was employeeTypeEnum)
//   • shifts             (was shiftEnum)
//
// Each table has:
//   id        serial PK   — used by FK columns on other tables
//   code      text UNIQUE — stable machine identifier checked by app logic
//                           (e.g. 'ops', 'pic_1', 'morning'). NEVER rename this
//                           once code paths reference it; rename `label` instead.
//   label     text        — human-friendly name shown in the UI
//   …         table-specific columns
//   isActive  boolean     — soft-disable without deleting (preserves FK history)
//   sortOrder integer     — display order in admin pickers
//
// Seeded shift codes (DO NOT RENAME):
//   'morning'   — morning shift
//   'evening'   — evening shift
//   'full_day'  — NEW: single employee covers both morning and evening tasks
//                 materialiseTasksForSchedule detects this code and creates task
//                 rows for both morning-type and evening-type tasks. It also
//                 allows two break sessions (full_day_lunch + full_day_dinner).
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  time,
} from 'drizzle-orm/pg-core';

// ─── User Roles ───────────────────────────────────────────────────────────────

export const userRoles = pgTable('user_roles', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').default(true).notNull(),
  sortOrder:   integer('sort_order').default(0).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Employee Types ───────────────────────────────────────────────────────────

export const employeeTypes = pgTable('employee_types', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').default(true).notNull(),
  sortOrder:   integer('sort_order').default(0).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Shifts ───────────────────────────────────────────────────────────────────
// Seeded values:
//   code='morning'  label='Morning'   startTime='07:00' endTime='15:00'
//   code='evening'  label='Evening'   startTime='13:00' endTime='22:00'
//   code='full_day' label='Full Day'  startTime='07:00' endTime='22:00'
//
// The `full_day` shift is handled specially in:
//   • schedule-utils.ts  → SHIFT_CONFIG['full_day']
//   • tasks.ts utils     → materialiseTasksForSchedule (creates both morning + evening tasks)
//   • startBreak         → allows two break sessions per attendance record

export const shifts = pgTable('shifts', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  startTime:   time('start_time'),
  endTime:     time('end_time'),
  isActive:    boolean('is_active').default(true).notNull(),
  sortOrder:   integer('sort_order').default(0).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type UserRole        = typeof userRoles.$inferSelect;
export type NewUserRole     = typeof userRoles.$inferInsert;
export type EmployeeType    = typeof employeeTypes.$inferSelect;
export type NewEmployeeType = typeof employeeTypes.$inferInsert;
export type Shift           = typeof shifts.$inferSelect;
export type NewShift        = typeof shifts.$inferInsert;