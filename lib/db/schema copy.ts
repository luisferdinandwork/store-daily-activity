// lib/db/schema.ts
import {
  pgTable, text, timestamp, integer, boolean,
  decimal, uuid, pgEnum, unique,
} from 'drizzle-orm/pg-core';

// ─── Enums ────────────────────────────────────────────────────────────────────
export const userRoleEnum         = pgEnum('user_role',         ['employee', 'ops', 'finance', 'admin']);
export const employeeTypeEnum     = pgEnum('employee_type',     ['pic_1', 'pic_2', 'so']);
export const shiftEnum            = pgEnum('shift',             ['morning', 'evening']);
export const issueStatusEnum      = pgEnum('issue_status',      ['reported', 'in_review', 'resolved']);
export const reportStatusEnum     = pgEnum('report_status',     ['draft', 'submitted', 'verified', 'rejected']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused']);
export const taskStatusEnum       = pgEnum('task_status',       ['pending', 'in_progress', 'completed']);

/**
 * Break type:
 *  - 'lunch'  → available during morning shift (08:00–17:00)
 *  - 'dinner' → available during evening shift (13:00–22:00)
 */
export const breakTypeEnum = pgEnum('break_type', ['lunch', 'dinner']);

// ─── Area ─────────────────────────────────────────────────────────────────────
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
  employeeType: employeeTypeEnum('employee_type'),
  /**
   * homeStoreId: the store the employee is primarily assigned to.
   * This is their "default" store for login/access purposes.
   * Monthly schedules may assign them to a different store for a given month.
   */
  homeStoreId:  uuid('home_store_id').references(() => stores.id),
  areaId:       uuid('area_id').references(() => areas.id),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

export const stores = pgTable('stores', {
  id:               uuid('id').primaryKey().defaultRandom(),
  name:             text('name').notNull(),
  address:          text('address').notNull(),
  areaId:           uuid('area_id').references(() => areas.id).notNull(),
  pettyCashBalance: decimal('petty_cash_balance', { precision: 10, scale: 2 }).default('1000000'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

// ─── Monthly Schedule ─────────────────────────────────────────────────────────
/**
 * A MonthlySchedule groups all schedule entries for one store in one month.
 *
 * Lifecycle:
 *   1. PIC 1 (or OPS) imports the Excel → creates one MonthlySchedule per store-section.
 *   2. They can edit individual days via MonthlyScheduleEntries at any time.
 *   3. At month-end the schedule remains as a historical record; a new one is
 *      created for the next month.
 *
 * yearMonth is stored as "YYYY-MM" (e.g. "2026-03") for easy querying.
 */
export const monthlySchedules = pgTable('monthly_schedules', {
  id:         uuid('id').primaryKey().defaultRandom(),
  storeId:    uuid('store_id').references(() => stores.id).notNull(),
  yearMonth:  text('year_month').notNull(),           // "YYYY-MM"
  importedBy: uuid('imported_by').references(() => users.id),
  note:       text('note'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.storeId, t.yearMonth),          // one schedule per store per month
}));

/**
 * One row = one employee's shift on one specific date.
 *
 * - userId links to the employee. The employee may be from a different home store
 *   (cross-store deployment is fully supported here).
 * - shift: 'morning' | 'evening'
 * - isOff: true when the employee is scheduled OFF that day (no shift worked)
 * - isLeave: true for AL/CU/SICK days
 *
 * To change a day's assignment: UPDATE the entry's shift/isOff/isLeave flags
 * or DELETE it and re-insert. The daily `schedules` row is regenerated lazily.
 */
export const monthlyScheduleEntries = pgTable('monthly_schedule_entries', {
  id:                uuid('id').primaryKey().defaultRandom(),
  monthlyScheduleId: uuid('monthly_schedule_id').references(() => monthlySchedules.id, { onDelete: 'cascade' }).notNull(),
  userId:            uuid('user_id').references(() => users.id).notNull(),
  storeId:           uuid('store_id').references(() => stores.id).notNull(),
  date:              timestamp('date').notNull(),      // midnight of the scheduled day
  shift:             shiftEnum('shift'),               // null when isOff or isLeave
  isOff:             boolean('is_off').default(false).notNull(),
  isLeave:           boolean('is_leave').default(false).notNull(),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  updatedAt:         timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.monthlyScheduleId, t.userId, t.date),
}));

// ─── Daily Schedules (materialised from monthly entries) ──────────────────────
/**
 * One row = one employee working one shift on one date at one store.
 * Generated from MonthlyScheduleEntries (only for working days, not OFF/leave).
 * This table drives attendance, tasks, and check-in/out.
 */
export const schedules = pgTable('schedules', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  userId:                  uuid('user_id').references(() => users.id).notNull(),
  storeId:                 uuid('store_id').references(() => stores.id).notNull(),
  shift:                   shiftEnum('shift').notNull(),
  date:                    timestamp('date').notNull(),
  monthlyScheduleEntryId:  uuid('monthly_schedule_entry_id').references(() => monthlyScheduleEntries.id),
  isHoliday:               boolean('is_holiday').default(false),
  createdAt:               timestamp('created_at').defaultNow().notNull(),
  updatedAt:               timestamp('updated_at').defaultNow().notNull(),
});

// ─── Attendance ───────────────────────────────────────────────────────────────
/**
 * Shift hours:
 *   morning → 08:00–17:00  (late if check-in after 08:30)
 *   evening → 13:00–22:00  (late if check-in after 13:30)
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

// ─── Store Opening Task ───────────────────────────────────────────────────────
export const storeOpeningTasks = pgTable('store_opening_tasks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id).notNull(),
  storeId:      uuid('store_id').references(() => stores.id).notNull(),
  scheduleId:   uuid('schedule_id').references(() => schedules.id),
  attendanceId: uuid('attendance_id').references(() => attendance.id),
  date:         timestamp('date').notNull(),
  shift:        shiftEnum('shift').notNull(),

  cashDrawerAmount: integer('cash_drawer_amount'),
  allLightsOn:      boolean('all_lights_on'),
  cleanlinessCheck: boolean('cleanliness_check'),
  equipmentCheck:   boolean('equipment_check'),
  stockCheck:       boolean('stock_check'),
  safetyCheck:      boolean('safety_check'),
  openingNotes:     text('opening_notes'),
  storeFrontPhotos: text('store_front_photos'),
  cashDrawerPhotos: text('cash_drawer_photos'),

  status:      taskStatusEnum('status').default('pending').notNull(),
  completedAt: timestamp('completed_at'),
  verifiedBy:  uuid('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Grooming Task ────────────────────────────────────────────────────────────
export const groomingTasks = pgTable('grooming_tasks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id).notNull(),
  storeId:      uuid('store_id').references(() => stores.id).notNull(),
  scheduleId:   uuid('schedule_id').references(() => schedules.id),
  attendanceId: uuid('attendance_id').references(() => attendance.id),
  date:         timestamp('date').notNull(),
  shift:        shiftEnum('shift').notNull(),

  uniformComplete:      boolean('uniform_complete'),
  hairGroomed:          boolean('hair_groomed'),
  nailsClean:           boolean('nails_clean'),
  accessoriesCompliant: boolean('accessories_compliant'),
  shoeCompliant:        boolean('shoe_compliant'),
  groomingNotes:        text('grooming_notes'),
  selfiePhotos:         text('selfie_photos'),

  status:      taskStatusEnum('status').default('pending').notNull(),
  completedAt: timestamp('completed_at'),
  verifiedBy:  uuid('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Other tables ─────────────────────────────────────────────────────────────
export const issues = pgTable('issues', {
  id:             uuid('id').primaryKey().defaultRandom(),
  title:          text('title').notNull(),
  description:    text('description').notNull(),
  userId:         uuid('user_id').references(() => users.id).notNull(),
  storeId:        uuid('store_id').references(() => stores.id).notNull(),
  status:         issueStatusEnum('status').default('reported').notNull(),
  attachmentUrls: text('attachment_urls'),
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
  users,
  stores,
  monthlySchedules,
  monthlyScheduleEntries,
  schedules,
  attendance,
  breakSessions,
  storeOpeningTasks,
  groomingTasks,
  issues,
  pettyCashTransactions,
  dailyReports,
};

export type Area                     = typeof areas.$inferSelect;
export type User                     = typeof users.$inferSelect;
export type Store                    = typeof stores.$inferSelect;
export type MonthlySchedule          = typeof monthlySchedules.$inferSelect;
export type NewMonthlySchedule       = typeof monthlySchedules.$inferInsert;
export type MonthlyScheduleEntry     = typeof monthlyScheduleEntries.$inferSelect;
export type NewMonthlyScheduleEntry  = typeof monthlyScheduleEntries.$inferInsert;
export type Schedule                 = typeof schedules.$inferSelect;
export type Attendance               = typeof attendance.$inferSelect;
export type BreakSession             = typeof breakSessions.$inferSelect;
export type StoreOpeningTask         = typeof storeOpeningTasks.$inferSelect;
export type NewStoreOpeningTask      = typeof storeOpeningTasks.$inferInsert;
export type GroomingTask             = typeof groomingTasks.$inferSelect;
export type NewGroomingTask          = typeof groomingTasks.$inferInsert;
export type Issue                    = typeof issues.$inferSelect;

export type BreakType  = 'lunch' | 'dinner';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

/**
 * 'pic_1' → store schedule owner; can create/edit schedules for their store
 * 'pic_2' → senior employee; read-only schedule access
 * 'so'    → standard operator; read-only schedule access
 */
export type EmployeeType = 'pic_1' | 'pic_2' | 'so';