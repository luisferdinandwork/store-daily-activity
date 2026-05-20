// lib/db/schema/core.ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  decimal,
  integer,
  unique,
  serial,
  index,
} from 'drizzle-orm/pg-core';
import {
  attendanceStatusEnum,
  breakTypeEnum,
} from './enums';
import { userRoles, employeeTypes, shifts } from './lookups';

// ─── Area ─────────────────────────────────────────────────────────────────────

export const areas = pgTable('areas', {
  id:        serial('id').primaryKey(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Store ────────────────────────────────────────────────────────────────────

export const stores = pgTable('stores', {
  id:               serial('id').primaryKey(),
  name:             text('name').notNull(),
  address:          text('address').notNull(),
  latitude:         decimal('latitude',  { precision: 10, scale: 7 }),
  longitude:        decimal('longitude', { precision: 10, scale: 7 }),
  geofenceRadiusM:  decimal('geofence_radius_m', { precision: 8, scale: 2 }).default('100'),
  areaId:           integer('area_id').references(() => areas.id).notNull(),
  pettyCashBalance: decimal('petty_cash_balance', { precision: 12, scale: 2 }).default('1000000'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

// ─── User ─────────────────────────────────────────────────────────────────────
//
// Login identity is now NIK, not email.
//
// Important:
// - users.id remains the internal generated app ID.
// - users.nik is the unique office/employee identity.
// - All FK references still point to users.id, so historical task,
//   schedule, attendance, report, and verification records stay stable.
// - NIK can be used later for sync to office API / sales API.

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  nik: text('nik').notNull().unique(),

  name:     text('name').notNull(),
  password: text('password').notNull(),

  /**
   * roleId / employeeTypeId are FKs into lookup tables in lookups.ts.
   * Admins should soft-disable roles/types via isActive instead of deleting.
   */
  roleId:         integer('role_id').references(() => userRoles.id).notNull(),
  employeeTypeId: integer('employee_type_id').references(() => employeeTypes.id),

  /**
   * Current/default assignment.
   * This is safe to update when a user moves store.
   * Old schedule/task rows keep their own storeId snapshots.
   */
  homeStoreId: integer('home_store_id').references(() => stores.id),
  areaId:      integer('area_id').references(() => areas.id),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  nikIdx: index('users_nik_idx').on(t.nik),
  homeStoreIdx: index('users_home_store_idx').on(t.homeStoreId),
  areaIdx: index('users_area_idx').on(t.areaId),
}));

// ─── User Store / Role Assignment History ─────────────────────────────────────
//
// This table keeps movement history when an employee moves from one store
// to another or changes role/type.
// The current user table keeps the latest active assignment,
// while this table preserves the timeline.

export const userStoreAssignments = pgTable('user_store_assignments', {
  id: serial('id').primaryKey(),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),

  storeId: integer('store_id')
    .references(() => stores.id)
    .notNull(),

  areaId: integer('area_id')
    .references(() => areas.id),

  roleId: integer('role_id')
    .references(() => userRoles.id)
    .notNull(),

  employeeTypeId: integer('employee_type_id')
    .references(() => employeeTypes.id),

  effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
  effectiveTo: timestamp('effective_to'),

  isActive: boolean('is_active').default(true).notNull(),

  assignedBy: text('assigned_by').references(() => users.id),
  notes: text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userActiveIdx: index('user_store_assignments_user_active_idx').on(t.userId, t.isActive),
  storeActiveIdx: index('user_store_assignments_store_active_idx').on(t.storeId, t.isActive),
}));

// ─── Monthly Schedule ─────────────────────────────────────────────────────────

export const monthlySchedules = pgTable('monthly_schedules', {
  id:         serial('id').primaryKey(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  yearMonth:  text('year_month').notNull(),   // "YYYY-MM"
  importedBy: text('imported_by').references(() => users.id),
  note:       text('note'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.storeId, t.yearMonth),
}));

export const monthlyScheduleEntries = pgTable('monthly_schedule_entries', {
  id:                serial('id').primaryKey(),
  monthlyScheduleId: integer('monthly_schedule_id').references(() => monthlySchedules.id, { onDelete: 'cascade' }).notNull(),
  userId:            text('user_id').references(() => users.id).notNull(),
  storeId:           integer('store_id').references(() => stores.id).notNull(),
  date:              timestamp('date').notNull(),
  shiftId:           integer('shift_id').references(() => shifts.id),
  isOff:             boolean('is_off').default(false).notNull(),
  isLeave:           boolean('is_leave').default(false).notNull(),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  updatedAt:         timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.monthlyScheduleId, t.userId, t.date),
}));

// ─── Daily Schedule (materialised) ───────────────────────────────────────────

export const schedules = pgTable('schedules', {
  id:                     serial('id').primaryKey(),
  userId:                 text('user_id').references(() => users.id).notNull(),
  storeId:                integer('store_id').references(() => stores.id).notNull(),
  shiftId:                integer('shift_id').references(() => shifts.id).notNull(),
  date:                   timestamp('date').notNull(),
  monthlyScheduleEntryId: integer('monthly_schedule_entry_id').references(() => monthlyScheduleEntries.id),
  isHoliday:              boolean('is_holiday').default(false),
  createdAt:              timestamp('created_at').defaultNow().notNull(),
  updatedAt:              timestamp('updated_at').defaultNow().notNull(),
});

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendance = pgTable('attendance', {
  id:           serial('id').primaryKey(),
  scheduleId:   integer('schedule_id').references(() => schedules.id).notNull().unique(),
  userId:       text('user_id').references(() => users.id).notNull(),
  storeId:      integer('store_id').references(() => stores.id).notNull(),
  date:         timestamp('date').notNull(),
  shiftId:      integer('shift_id').references(() => shifts.id).notNull(),
  status:       attendanceStatusEnum('status').default('present').notNull(),
  checkInTime:  timestamp('check_in_time'),
  checkOutTime: timestamp('check_out_time'),
  onBreak:      boolean('on_break').default(false).notNull(),
  notes:        text('notes'),
  recordedBy:   text('recorded_by').references(() => users.id),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

export const breakSessions = pgTable('break_sessions', {
  id:           serial('id').primaryKey(),
  attendanceId: integer('attendance_id').references(() => attendance.id, { onDelete: 'cascade' }).notNull(),
  userId:       text('user_id').references(() => users.id).notNull(),
  storeId:      integer('store_id').references(() => stores.id).notNull(),
  breakType:    breakTypeEnum('break_type').notNull(),
  breakOutTime: timestamp('break_out_time').notNull(),
  returnTime:   timestamp('return_time'),

  cashOut: decimal('cash_out', { precision: 12, scale: 2 }).notNull(),
  cashIn:  decimal('cash_in',  { precision: 12, scale: 2 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Petty Cash & Reports ─────────────────────────────────────────────────────

export const pettyCashTransactions = pgTable('petty_cash_transactions', {
  id:          serial('id').primaryKey(),
  amount:      decimal('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description').notNull(),
  userId:      text('user_id').references(() => users.id).notNull(),
  storeId:     integer('store_id').references(() => stores.id).notNull(),
  approvedBy:  text('approved_by').references(() => users.id),
  approvedAt:  timestamp('approved_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

export const issues = pgTable('issues', {
  id:             serial('id').primaryKey(),
  title:          text('title').notNull(),
  description:    text('description').notNull(),
  userId:         text('user_id').references(() => users.id).notNull(),
  storeId:        integer('store_id').references(() => stores.id).notNull(),
  status:         text('status').default('reported').notNull(),
  attachmentUrls: text('attachment_urls'),
  reviewedBy:     text('reviewed_by').references(() => users.id),
  reviewedAt:     timestamp('reviewed_at'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

export const dailyReports = pgTable('daily_reports', {
  id:            serial('id').primaryKey(),
  type:          text('type').notNull(),
  date:          timestamp('date').notNull(),
  actualAmount:  decimal('actual_amount',  { precision: 12, scale: 2 }).notNull(),
  roundedAmount: decimal('rounded_amount', { precision: 12, scale: 2 }).notNull(),
  userId:        text('user_id').references(() => users.id).notNull(),
  storeId:       integer('store_id').references(() => stores.id).notNull(),
  issueId:       integer('issue_id').references(() => issues.id),
  status:        text('status').default('draft').notNull(),
  verifiedBy:    text('verified_by').references(() => users.id),
  verifiedAt:    timestamp('verified_at'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type Area                    = typeof areas.$inferSelect;
export type Store                   = typeof stores.$inferSelect;
export type User                    = typeof users.$inferSelect;
export type NewUser                 = typeof users.$inferInsert;
export type UserStoreAssignment     = typeof userStoreAssignments.$inferSelect;
export type NewUserStoreAssignment  = typeof userStoreAssignments.$inferInsert;
export type MonthlySchedule         = typeof monthlySchedules.$inferSelect;
export type NewMonthlySchedule      = typeof monthlySchedules.$inferInsert;
export type MonthlyScheduleEntry    = typeof monthlyScheduleEntries.$inferSelect;
export type NewMonthlyScheduleEntry = typeof monthlyScheduleEntries.$inferInsert;
export type Schedule                = typeof schedules.$inferSelect;
export type Attendance              = typeof attendance.$inferSelect;
export type BreakSession            = typeof breakSessions.$inferSelect;