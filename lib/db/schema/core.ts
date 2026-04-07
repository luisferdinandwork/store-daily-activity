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

export const users = pgTable('users', {
  id:             text('id').primaryKey(),       // custom format e.g. "EMP-001"
  name:           text('name').notNull(),
  email:          text('email').notNull().unique(),
  password:       text('password').notNull(),
  /**
   * roleId / employeeTypeId are FKs into the lookup tables in lookups.ts.
   * Use `restrict` semantics: a role/type cannot be deleted while users still
   * reference it. Admins should soft-disable via isActive instead.
   */
  roleId:         integer('role_id').references(() => userRoles.id).notNull(),
  employeeTypeId: integer('employee_type_id').references(() => employeeTypes.id),
  homeStoreId:    integer('home_store_id').references(() => stores.id),
  areaId:         integer('area_id').references(() => areas.id),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

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
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
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
export type MonthlySchedule         = typeof monthlySchedules.$inferSelect;
export type NewMonthlySchedule      = typeof monthlySchedules.$inferInsert;
export type MonthlyScheduleEntry    = typeof monthlyScheduleEntries.$inferSelect;
export type NewMonthlyScheduleEntry = typeof monthlyScheduleEntries.$inferInsert;
export type Schedule                = typeof schedules.$inferSelect;
export type Attendance              = typeof attendance.$inferSelect;
export type BreakSession            = typeof breakSessions.$inferSelect;