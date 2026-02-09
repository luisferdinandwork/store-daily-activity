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

// Attendance table - tracks actual attendance based on schedules
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
  recordedBy: uuid('recorded_by').references(() => users.id), // OPS user who recorded it
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tasks table - Master list of daily tasks created by OPS
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  role: userRoleEnum('role').notNull(),
  employeeType: employeeTypeEnum('employee_type'),
  shift: shiftEnum('shift'),
  isDaily: boolean('is_daily').default(true),
  // Form configuration for task completion
  requiresForm: boolean('requires_form').default(false),
  formSchema: text('form_schema'), // JSON schema defining form fields
  requiresAttachment: boolean('requires_attachment').default(false),
  maxAttachments: integer('max_attachments').default(1),
  createdBy: uuid('created_by').references(() => users.id), // OPS user who created it
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Employee Tasks table (junction table for tasks assigned to employees)
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
  // Form submission fields
  formData: text('form_data'), // JSON string for form responses
  attachmentUrls: text('attachment_urls'), // JSON array of file URLs
  notes: text('notes'),
  verifiedBy: uuid('verified_by').references(() => users.id), // OPS user who verified completion
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