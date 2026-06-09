// lib/db/schema/lookups.ts
// ─────────────────────────────────────────────────────────────────────────────
// Admin-managed lookup tables.
//
// These replace what used to be Postgres enums for:
//   • user roles
//   • employee types
//   • shifts
//
// Shift rows now also hold display/config fields used by the OPS Shift & Tasks
// page: accent, icon, and JSON break definitions.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  time,
  jsonb,
} from 'drizzle-orm/pg-core';

type ShiftBreakJson = Array<{
  type: 'lunch' | 'dinner' | 'full_day_lunch' | 'full_day_dinner';
  label: string;
  accent?: 'amber' | 'violet' | 'emerald' | 'sky' | 'rose' | 'slate';
}>;

// ─── User Roles ───────────────────────────────────────────────────────────────

export const userRoles = pgTable('user_roles', {
  id:               serial('id').primaryKey(),
  code:             text('code').notNull().unique(),
  label:            text('label').notNull(),
  description:      text('description'),
  canReceiveIssues: boolean('can_receive_issues').default(false).notNull(),
  isActive:         boolean('is_active').default(true).notNull(),
  sortOrder:        integer('sort_order').default(0).notNull(),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
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
// Required stable codes:
//   morning, evening, full_day
//
// `breaks` stores ShiftBreakDef[] as JSONB. The break.type values must stay in
// sync with breakTypeEnum in enums.ts because attendance break sessions insert
// those exact strings.

export const shifts = pgTable('shifts', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  startTime:   time('start_time'),
  endTime:     time('end_time'),

  // Display/config fields used by /ops/shift-tasks.
  accent:      text('accent'),
  icon:        text('icon'),
  breaks:      jsonb('breaks').$type<ShiftBreakJson | null>(),

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
