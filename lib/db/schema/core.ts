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
  issueStatusEnum,
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
  id: serial('id').primaryKey(),

  /**
   * Business Central / POS store code.
   * This must match ppQueryTransSalesEntries.storeNo, e.g. FF001, FS033.
   * Keep this separate from `name` so the display name can change without
   * breaking performance matching.
   */
  storeNo: text('store_no').notNull(),

  name:    text('name').notNull(),
  address: text('address').notNull(),

  latitude:        decimal('latitude',         { precision: 10, scale: 7 }),
  longitude:       decimal('longitude',        { precision: 10, scale: 7 }),
  geofenceRadiusM: decimal('geofence_radius_m',{ precision:  8, scale: 2 }).default('100'),

  areaId:           integer('area_id').references(() => areas.id).notNull(),
  pettyCashBalance: decimal('petty_cash_balance', { precision: 12, scale: 2 }).default('1000000'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  storeNoUnique: unique('stores_store_no_unique').on(t.storeNo),
  areaIdx:       index('stores_area_idx').on(t.areaId),
}));

// ─── User ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  nik:      text('nik').notNull().unique(),
  name:     text('name').notNull(),
  password: text('password').notNull(),

  roleId:         integer('role_id').references(() => userRoles.id).notNull(),
  employeeTypeId: integer('employee_type_id').references(() => employeeTypes.id),

  /**
   * Set only for an IT user who has temporarily switched their own account
   * into another role to preview it — holds their real IT role/employeeType
   * so they can switch back. Null under normal operation.
   */
  switchedFromRoleId:         integer('switched_from_role_id').references(() => userRoles.id),
  switchedFromEmployeeTypeId: integer('switched_from_employee_type_id').references(() => employeeTypes.id),

  homeStoreId: integer('home_store_id').references(() => stores.id),
  areaId:      integer('area_id').references(() => areas.id),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  nikIdx:       index('users_nik_idx').on(t.nik),
  homeStoreIdx: index('users_home_store_idx').on(t.homeStoreId),
  areaIdx:      index('users_area_idx').on(t.areaId),
}));

// ─── Business Central API Settings ───────────────────────────────────────────

export const businessCentralSettings = pgTable('business_central_settings', {
  id: serial('id').primaryKey(),

  code: text('code').notNull().default('sales_entries'),
  name: text('name').notNull().default('Business Central Sales Entries'),

  apiUrl:      text('api_url').notNull(),
  username:    text('username'),
  password:    text('password'),
  bearerToken: text('bearer_token'),
  authType:    text('auth_type').default('basic').notNull(),

  isActive: boolean('is_active').default(true).notNull(),

  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  codeUnique: unique('business_central_settings_code_unique').on(t.code),
  activeIdx:  index('business_central_settings_active_idx').on(t.isActive),
}));

// ─── User Store / Role Assignment History ─────────────────────────────────────

export const userStoreAssignments = pgTable('user_store_assignments', {
  id: serial('id').primaryKey(),

  userId:  text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  storeId: integer('store_id').references(() => stores.id).notNull(),
  areaId:  integer('area_id').references(() => areas.id),
  roleId:  integer('role_id').references(() => userRoles.id).notNull(),
  employeeTypeId: integer('employee_type_id').references(() => employeeTypes.id),

  effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
  effectiveTo:   timestamp('effective_to'),

  isActive:    boolean('is_active').default(true).notNull(),
  isTemporary: boolean('is_temporary').default(false).notNull(),

  previousStoreId:        integer('previous_store_id').references(() => stores.id),
  previousAreaId:         integer('previous_area_id').references(() => areas.id),
  previousRoleId:         integer('previous_role_id').references(() => userRoles.id),
  previousEmployeeTypeId: integer('previous_employee_type_id').references(() => employeeTypes.id),

  revertedAt: timestamp('reverted_at'),
  assignedBy: text('assigned_by').references(() => users.id),
  notes:      text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userActiveIdx:  index('user_store_assignments_user_active_idx').on(t.userId, t.isActive),
  storeActiveIdx: index('user_store_assignments_store_active_idx').on(t.storeId, t.isActive),
  tempExpiryIdx:  index('user_store_assignments_temp_expiry_idx').on(t.isTemporary, t.isActive, t.effectiveTo),
}));

// ─── Monthly Schedule ─────────────────────────────────────────────────────────

export const monthlySchedules = pgTable('monthly_schedules', {
  id:         serial('id').primaryKey(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  yearMonth:  text('year_month').notNull(),
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
  cashOut:      decimal('cash_out', { precision: 12, scale: 2 }).notNull(),
  cashIn:       decimal('cash_in',  { precision: 12, scale: 2 }),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

// ─── Issues ──────────────────────────────────────────────────────────────────

export const issues = pgTable('issues', {
  id:          serial('id').primaryKey(),
  title:       text('title').notNull(),
  description: text('description').notNull(),

  userId:           text('user_id').references(() => users.id).notNull(),
  storeId:          integer('store_id').references(() => stores.id).notNull(),
  assignedToRoleId: integer('assigned_to_role_id').references(() => userRoles.id).notNull(),

  status:         issueStatusEnum('status').default('reported').notNull(),
  attachmentUrls: text('attachment_urls'),

  // Berita Acara — one-time evidence upload the reporter can attach at ANY
  // status, including draft (even after completed/solved).
  baAttachmentUrls: text('ba_attachment_urls'),
  baUploadedBy:     text('ba_uploaded_by').references(() => users.id),
  baUploadedAt:     timestamp('ba_uploaded_at'),

  // OPS marks "completed" first; the reporter then gives final sign-off with "solved".
  solvedBy: text('solved_by').references(() => users.id),
  solvedAt: timestamp('solved_at'),

  reviewedBy: text('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  reporterIdx:     index('issues_reporter_idx').on(t.userId),
  storeIdx:        index('issues_store_idx').on(t.storeId),
  assignedRoleIdx: index('issues_assigned_role_idx').on(t.assignedToRoleId),
  statusIdx:       index('issues_status_idx').on(t.status),
}));

export const issueRoleAssignments = pgTable('issue_role_assignments', {
  id: serial('id').primaryKey(),

  issueId: integer('issue_id').references(() => issues.id, { onDelete: 'cascade' }).notNull(),
  roleId:  integer('role_id').references(() => userRoles.id, { onDelete: 'cascade' }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqIssueRole: unique('issue_role_assignments_issue_role_unique').on(t.issueId, t.roleId),
  issueIdx:      index('issue_role_assignments_issue_idx').on(t.issueId),
  roleIdx:       index('issue_role_assignments_role_idx').on(t.roleId),
}));

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

// ─── Types ───────────────────────────────────────────────────────────────────
//
// NOTE: PettyCashTransaction types are now in petty-cash.ts.
// pettyCashTransactions was removed from this file.

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
export type Issue                   = typeof issues.$inferSelect;
export type NewIssue                = typeof issues.$inferInsert;
export type IssueRoleAssignment     = typeof issueRoleAssignments.$inferSelect;
export type NewIssueRoleAssignment  = typeof issueRoleAssignments.$inferInsert;
export type BusinessCentralSetting    = typeof businessCentralSettings.$inferSelect;
export type NewBusinessCentralSetting = typeof businessCentralSettings.$inferInsert;
export type DailyReport             = typeof dailyReports.$inferSelect;