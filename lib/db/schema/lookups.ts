// lib/db/schema/lookups.ts
// ─────────────────────────────────────────────────────────────────────────────
// Admin-managed lookup tables.
// These replace what used to be Postgres enums for:
//   • user roles         (was userRoleEnum)
//   • employee types     (was employeeTypeEnum)
//   • shifts             (was shiftEnum)
//
// Each table has:
//   id     serial PK   — used by FK columns on other tables
//   code   text UNIQUE — stable machine identifier checked by app logic
//                       (e.g. 'ops', 'pic_1', 'morning'). NEVER rename this
//                       once code paths reference it; rename `label` instead.
//   label  text        — human-friendly name shown in the UI
//   …      table-specific columns
//   isActive boolean   — soft-disable without deleting (preserves FK history)
//   sortOrder integer  — display order in admin pickers
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
// Examples seeded: employee, ops, finance, admin

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
// Examples seeded: pic_1, pic_2, so

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
// Examples seeded: morning, evening
// startTime/endTime are nullable so admins can create label-only shifts
// and fill in times later. Used in the future for scheduling validation.

export const shifts = pgTable('shifts', {
  id:          serial('id').primaryKey(),
  code:        text('code').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  startTime:   time('start_time'),       // e.g. '07:00:00'
  endTime:     time('end_time'),         // e.g. '15:00:00'
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