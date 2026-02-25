// lib/db/schema.ts
import { pgTable, text, timestamp, integer, boolean, decimal, uuid, pgEnum } from 'drizzle-orm/pg-core';

// Enums
export const userRoleEnum = pgEnum('user_role', ['employee', 'ops', 'finance', 'admin']);
export const employeeTypeEnum = pgEnum('employee_type', ['pic', 'so']);
export const shiftEnum = pgEnum('shift', ['morning', 'evening']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed']);
export const issueStatusEnum = pgEnum('issue_status', ['reported', 'in_review', 'resolved']);
export const reportStatusEnum = pgEnum('report_status', ['draft', 'submitted', 'verified', 'rejected']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused']);

/**
 * Task Recurrence Type:
 *  - 'daily'   → appears every day automatically
 *  - 'weekly'  → OPS picks specific weekday(s) within the week (0=Sun … 6=Sat)
 *                stored as JSON array in recurrenceDays, e.g. [1,3,5]
 *  - 'monthly' → OPS picks specific calendar day(s) within the month (1–31)
 *                stored as JSON array in recurrenceDays, e.g. [1,15]
 *
 * Both weekly and monthly tasks are NOT auto-generated — the engine checks
 * recurrenceDays each day and only creates employeeTasks on matching days.
 */
export const taskRecurrenceEnum = pgEnum('task_recurrence', ['daily', 'weekly', 'monthly']);

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  role: userRoleEnum('role').notNull(),
  employeeType: employeeTypeEnum('employee_type'),
  storeId: uuid('store_id').references(() => stores.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Stores table
export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  pettyCashBalance: decimal('petty_cash_balance', { precision: 10, scale: 2 }).default('1000000'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Schedules table
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  shift: shiftEnum('shift').notNull(),
  date: timestamp('date').notNull(),
  isHoliday: boolean('is_holiday').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Attendance table
export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').references(() => schedules.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  date: timestamp('date').notNull(),
  shift: shiftEnum('shift').notNull(),
  status: attendanceStatusEnum('status').default('present').notNull(),
  checkInTime: timestamp('check_in_time'),
  checkOutTime: timestamp('check_out_time'),
  notes: text('notes'),
  recordedBy: uuid('recorded_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Tasks table — Master task templates created by OPS.
 *
 * Recurrence fields:
 *  recurrence       → 'daily' | 'weekly' | 'monthly'
 *  recurrenceDays   → JSON array (string-encoded):
 *                      daily   → null (ignored)
 *                      weekly  → weekday numbers [0-6], e.g. "[1,3,5]"
 *                      monthly → calendar days [1-31], e.g. "[1,15]"
 *
 * The old isDaily boolean is REPLACED by recurrence === 'daily'.
 * A task can appear multiple times per week / per month because
 * recurrenceDays can hold multiple values.
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),

  // Target audience
  role: userRoleEnum('role').notNull(),
  employeeType: employeeTypeEnum('employee_type'),  // null = all types
  shift: shiftEnum('shift'),                         // null = both shifts

  // Recurrence
  recurrence: taskRecurrenceEnum('recurrence').default('daily').notNull(),
  /**
   * JSON-encoded number array.
   * daily   → null
   * weekly  → [0-6]  (0=Sunday)
   * monthly → [1-31]
   */
  recurrenceDays: text('recurrence_days'),

  // Active / inactive flag (soft delete)
  isActive: boolean('is_active').default(true).notNull(),

  // Form configuration
  requiresForm: boolean('requires_form').default(false),
  formSchema: text('form_schema'),       // JSON schema string
  requiresAttachment: boolean('requires_attachment').default(false),
  maxAttachments: integer('max_attachments').default(1),

  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Employee Tasks table (junction — one row per task instance per shift)
export const employeeTasks = pgTable('employee_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  scheduleId: uuid('schedule_id').references(() => schedules.id),
  attendanceId: uuid('attendance_id').references(() => attendance.id),
  date: timestamp('date').notNull(),
  shift: shiftEnum('shift').notNull(),
  status: taskStatusEnum('status').default('pending').notNull(),
  completedAt: timestamp('completed_at'),
  formData: text('form_data'),           // JSON
  attachmentUrls: text('attachment_urls'), // JSON array
  notes: text('notes'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Issues table
export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  status: issueStatusEnum('status').default('reported').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Petty Cash Transactions table
export const pettyCashTransactions = pgTable('petty_cash_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  description: text('description').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Daily Reports table (BOD/EOD)
export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // 'BOD' or 'EOD'
  date: timestamp('date').notNull(),
  actualAmount: decimal('actual_amount', { precision: 10, scale: 2 }).notNull(),
  roundedAmount: decimal('rounded_amount', { precision: 10, scale: 2 }).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  issueId: uuid('issue_id').references(() => issues.id),
  status: reportStatusEnum('status').default('draft').notNull(),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Export all tables
export const schema = {
  users,
  stores,
  schedules,
  attendance,
  tasks,
  employeeTasks,
  issues,
  pettyCashTransactions,
  dailyReports,
};

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type EmployeeTask = typeof employeeTasks.$inferSelect;
export type NewEmployeeTask = typeof employeeTasks.$inferInsert;
export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
export type PettyCashTransaction = typeof pettyCashTransactions.$inferSelect;
export type NewPettyCashTransaction = typeof pettyCashTransactions.$inferInsert;
export type DailyReport = typeof dailyReports.$inferSelect;
export type NewDailyReport = typeof dailyReports.$inferInsert;

// Convenience type helpers
export type TaskRecurrence = 'daily' | 'weekly' | 'monthly';
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