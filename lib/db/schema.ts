// lib/db/schema.ts
import { pgTable, text, timestamp, integer, boolean, decimal, uuid, pgEnum, unique } from 'drizzle-orm/pg-core';

// ─── Enums ────────────────────────────────────────────────────────────────────
export const userRoleEnum         = pgEnum('user_role',         ['employee', 'ops', 'finance', 'admin']);
export const employeeTypeEnum     = pgEnum('employee_type',     ['pic_1', 'pic_2', 'so']);  // PIC split into pic_1 / pic_2
export const shiftEnum            = pgEnum('shift',             ['morning', 'evening']);
export const weekdayEnum          = pgEnum('weekday',           ['0', '1', '2', '3', '4', '5', '6']);
export const taskStatusEnum       = pgEnum('task_status',       ['pending', 'in_progress', 'completed']);
export const issueStatusEnum      = pgEnum('issue_status',      ['reported', 'in_review', 'resolved']);
export const reportStatusEnum     = pgEnum('report_status',     ['draft', 'submitted', 'verified', 'rejected']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused']);
export const taskRecurrenceEnum   = pgEnum('task_recurrence',   ['daily', 'weekly', 'monthly']);

/**
 * Break type:
 *  - 'lunch'  → available during morning shift (08:00–17:00)
 *  - 'dinner' → available during evening shift (13:00–22:00)
 */
export const breakTypeEnum = pgEnum('break_type', ['lunch', 'dinner']);

// ─── Area ─────────────────────────────────────────────────────────────────────
/**
 * An Area groups one or more Stores under a single OPS manager.
 * One OPS user is assigned to exactly one area (users.areaId).
 * OPS can manage schedules for ALL stores in their area, but only
 * with oversight — PIC 1 of each store is the day-to-day schedule owner.
 */
export const areas = pgTable('areas', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Core ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull(),
  email:        text('email').notNull().unique(),
  password:     text('password').notNull(),
  role:         userRoleEnum('role').notNull(),
  employeeType: employeeTypeEnum('employee_type'), // 'pic_1' | 'pic_2' | 'so' | null (for ops/finance/admin)
  storeId:      uuid('store_id').references(() => stores.id),
  /**
   * areaId is set for OPS users — links them to the area they oversee.
   * Non-OPS users leave this null; their store already implies the area.
   */
  areaId:       uuid('area_id').references(() => areas.id),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

export const stores = pgTable('stores', {
  id:               uuid('id').primaryKey().defaultRandom(),
  name:             text('name').notNull(),
  address:          text('address').notNull(),
  /**
   * Every store belongs to exactly one area.
   * OPS users assigned to that area can manage this store.
   */
  areaId:           uuid('area_id').references(() => areas.id).notNull(),
  pettyCashBalance: decimal('petty_cash_balance', { precision: 10, scale: 2 }).default('1000000'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

// ─── Weekly Schedule Templates ────────────────────────────────────────────────
/**
 * PIC 1 (or an OPS user for their area) creates ONE active template per
 * employee per store. The template defines WHICH weekdays + shift the employee
 * works each week.
 *
 * Authorization rules enforced in application layer:
 *   - Only users with role='ops' (for stores in their area) OR
 *     employeeType='pic_1' (for their own store) may create/update templates.
 *   - PIC 2 and SO employees cannot manage templates.
 *
 * This template is PERMANENT — it repeats every week automatically.
 * Schedules are auto-generated rolling 4 weeks ahead (see ensureSchedulesUpToDate).
 * No manual "Publish Week" needed. When the template changes, future schedules
 * are regenerated from the change date onward; past schedules are untouched.
 *
 * lastScheduledThrough: tracks how far ahead schedules have been generated.
 */
export const weeklyScheduleTemplates = pgTable('weekly_schedule_templates', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  userId:               uuid('user_id').references(() => users.id).notNull(),
  storeId:              uuid('store_id').references(() => stores.id).notNull(),
  isActive:             boolean('is_active').default(true).notNull(),
  note:                 text('note'),
  /**
   * The user who created/last modified this template.
   * May be a PIC 1 (for their own store) or an OPS user (for their area).
   */
  createdBy:            uuid('created_by').references(() => users.id),
  /**
   * The furthest date for which schedules have been generated from this template.
   * NULL means no schedules have been generated yet.
   */
  lastScheduledThrough: timestamp('last_scheduled_through'),
  createdAt:            timestamp('created_at').defaultNow().notNull(),
  updatedAt:            timestamp('updated_at').defaultNow().notNull(),
});

/**
 * One row per working slot in the template.
 * weekday: 0=Sun, 1=Mon … 6=Sat  (JS Date.getDay() convention).
 */
export const weeklyScheduleEntries = pgTable('weekly_schedule_entries', {
  id:         uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').references(() => weeklyScheduleTemplates.id, { onDelete: 'cascade' }).notNull(),
  weekday:    weekdayEnum('weekday').notNull(), // '0'=Sun … '6'=Sat
  shift:      shiftEnum('shift').notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
});

// ─── Daily Schedules (auto-generated from templates) ──────────────────────────
/**
 * Concrete per-day schedule rows generated by ensureSchedulesUpToDate().
 * Past schedules are never deleted when a template changes.
 */
export const schedules = pgTable('schedules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').references(() => users.id).notNull(),
  storeId:         uuid('store_id').references(() => stores.id).notNull(),
  shift:           shiftEnum('shift').notNull(),
  date:            timestamp('date').notNull(),
  templateEntryId: uuid('template_entry_id').references(() => weeklyScheduleEntries.id),
  isHoliday:       boolean('is_holiday').default(false),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
});

// ─── Attendance ───────────────────────────────────────────────────────────────
/**
 * Shift hours:
 *   morning → 08:00 – 17:00  (late if check-in after 08:30)
 *   evening → 13:00 – 22:00  (late if check-in after 13:30)
 *
 * One row per schedule (unique on scheduleId).
 */
export const attendance = pgTable('attendance', {
  id:           uuid('id').primaryKey().defaultRandom(),
  scheduleId:   uuid('schedule_id').references(() => schedules.id).notNull().unique(),
  userId:       uuid('user_id').references(() => users.id).notNull(),
  storeId:      uuid('store_id').references(() => stores.id).notNull(),
  date:         timestamp('date').notNull(),
  shift:        shiftEnum('shift').notNull(),
  status:       attendanceStatusEnum('status').default('present').notNull(),
  checkInTime:  timestamp('check_in_time'),
  checkOutTime: timestamp('check_out_time'),
  onBreak:      boolean('on_break').default(false).notNull(),
  notes:        text('notes'),
  recordedBy:   uuid('recorded_by').references(() => users.id),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

// ─── Break Sessions ───────────────────────────────────────────────────────────
export const breakSessions = pgTable('break_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  attendanceId: uuid('attendance_id').references(() => attendance.id, { onDelete: 'cascade' }).notNull(),
  userId:       uuid('user_id').references(() => users.id).notNull(),
  storeId:      uuid('store_id').references(() => stores.id).notNull(),
  breakType:    breakTypeEnum('break_type').notNull(),
  breakOutTime: timestamp('break_out_time').notNull(),
  returnTime:   timestamp('return_time'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id:          uuid('id').primaryKey().defaultRandom(),
  title:       text('title').notNull(),
  description: text('description'),

  role:         userRoleEnum('role').notNull(),
  employeeType: employeeTypeEnum('employee_type'),
  shift:        shiftEnum('shift'),

  recurrence:     taskRecurrenceEnum('recurrence').default('daily').notNull(),
  recurrenceDays: text('recurrence_days'),

  isActive: boolean('is_active').default(true).notNull(),

  requiresForm:       boolean('requires_form').default(false),
  formSchema:         text('form_schema'),
  requiresAttachment: boolean('requires_attachment').default(false),
  maxAttachments:     integer('max_attachments').default(1),

  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Employee Task Instances ──────────────────────────────────────────────────
export const employeeTasks = pgTable('employee_tasks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  taskId:         uuid('task_id').references(() => tasks.id).notNull(),
  userId:         uuid('user_id').references(() => users.id).notNull(),
  storeId:        uuid('store_id').references(() => stores.id).notNull(),
  scheduleId:     uuid('schedule_id').references(() => schedules.id),
  attendanceId:   uuid('attendance_id').references(() => attendance.id),
  date:           timestamp('date').notNull(),
  shift:          shiftEnum('shift').notNull(),
  status:         taskStatusEnum('status').default('pending').notNull(),
  completedAt:    timestamp('completed_at'),
  formData:       text('form_data'),
  attachmentUrls: text('attachment_urls'),
  notes:          text('notes'),
  verifiedBy:     uuid('verified_by').references(() => users.id),
  verifiedAt:     timestamp('verified_at'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

// ─── Other tables ─────────────────────────────────────────────────────────────
export const issues = pgTable('issues', {
  id:             uuid('id').primaryKey().defaultRandom(),
  title:          text('title').notNull(),
  description:    text('description').notNull(),
  userId:         uuid('user_id').references(() => users.id).notNull(),
  storeId:        uuid('store_id').references(() => stores.id).notNull(),
  status:         issueStatusEnum('status').default('reported').notNull(),
  attachmentUrls: text('attachment_urls'),          // ← NEW: JSON array of /issue-report/ paths
  reviewedBy:     uuid('reviewed_by').references(() => users.id),
  reviewedAt:     timestamp('reviewed_at'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

export const pettyCashTransactions = pgTable('petty_cash_transactions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  amount:      decimal('amount', { precision: 10, scale: 2 }).notNull(),
  description: text('description').notNull(),
  userId:      uuid('user_id').references(() => users.id).notNull(),
  storeId:     uuid('store_id').references(() => stores.id).notNull(),
  approvedBy:  uuid('approved_by').references(() => users.id),
  approvedAt:  timestamp('approved_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

export const dailyReports = pgTable('daily_reports', {
  id:            uuid('id').primaryKey().defaultRandom(),
  type:          text('type').notNull(),
  date:          timestamp('date').notNull(),
  actualAmount:  decimal('actual_amount',  { precision: 10, scale: 2 }).notNull(),
  roundedAmount: decimal('rounded_amount', { precision: 10, scale: 2 }).notNull(),
  userId:        uuid('user_id').references(() => users.id).notNull(),
  storeId:       uuid('store_id').references(() => stores.id).notNull(),
  issueId:       uuid('issue_id').references(() => issues.id),
  status:        reportStatusEnum('status').default('draft').notNull(),
  verifiedBy:    uuid('verified_by').references(() => users.id),
  verifiedAt:    timestamp('verified_at'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

// ─── Exports ──────────────────────────────────────────────────────────────────
export const schema = {
  areas,
  users, stores,
  weeklyScheduleTemplates, weeklyScheduleEntries,
  schedules, attendance,
  breakSessions,
  tasks, employeeTasks,
  issues, pettyCashTransactions, dailyReports,
};

export type Area                      = typeof areas.$inferSelect;
export type User                      = typeof users.$inferSelect;
export type Store                     = typeof stores.$inferSelect;
export type WeeklyScheduleTemplate    = typeof weeklyScheduleTemplates.$inferSelect;
export type NewWeeklyScheduleTemplate = typeof weeklyScheduleTemplates.$inferInsert;
export type WeeklyScheduleEntry       = typeof weeklyScheduleEntries.$inferSelect;
export type NewWeeklyScheduleEntry    = typeof weeklyScheduleEntries.$inferInsert;
export type Schedule                  = typeof schedules.$inferSelect;
export type Attendance                = typeof attendance.$inferSelect;
export type BreakSession              = typeof breakSessions.$inferSelect;
export type Task                      = typeof tasks.$inferSelect;
export type EmployeeTask              = typeof employeeTasks.$inferSelect;
export type Issue                     = typeof issues.$inferSelect;

export type BreakType      = 'lunch' | 'dinner';
export type TaskRecurrence = 'daily' | 'weekly' | 'monthly';

/**
 * 'pic_1' → store schedule owner; can create/edit templates for their store
 * 'pic_2' → senior employee; no schedule management permissions
 * 'so'    → standard operator
 */
export type EmployeeType = 'pic_1' | 'pic_2' | 'so';

export type TaskFormField = {
  id: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time';
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  validation?: { min?: number; max?: number; pattern?: string };
};
export type TaskFormSchema = { fields: TaskFormField[] };