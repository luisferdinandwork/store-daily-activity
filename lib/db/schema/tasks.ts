// lib/db/schema/tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// All shift-linked task tables.
//
// Design principles
// ─────────────────
//  1. Every task row is anchored to ONE scheduleId (→ a specific employee on a
//     specific shift on a specific date) and ONE storeId.
//
//  2. Geolocation is recorded at SUBMISSION time — not at creation — so
//     `submittedLat / submittedLng` are nullable columns present on every task.
//     Validation that the employee is within the store's geofence happens in
//     the API layer (see lib/db/utils/tasks.ts).
//
//  3. Images are stored on local disk under storage/<category>/<filename>.
//     The columns hold relative paths, e.g. "opening/2024-03-01_store1_cash.jpg".
//     Multiple images are stored as a JSON array in a single text column.
//
//  4. Shared vs personal tasks:
//       - Shared   → one row per store per shift (e.g. store opening, setoran).
//                    For most tasks: unique constraint on (storeId, date).
//       - Personal → one row per employee per shift (e.g. grooming).
//                    Unique constraint on (scheduleId).
//
//  5. Discrepancy carry-forward (evening tasks + briefing):
//       When an employee submits one of these tasks and marks it as NOT balanced /
//       NOT correct, the status is set to 'discrepancy' instead of 'completed'.
//       The next shift's employee then picks up the SAME task row and re-submits.
//       Because a single row can span multiple calendar days in this flow, the
//       per-(storeId, date) unique constraint is REMOVED from these tables — the
//       task is instead identified by its own PK and the parentTaskId chain.
//
//       parentTaskId  → null for the original task; set on every carry-forward row
//                        that was spawned because the prior row had status='discrepancy'.
//
//  6. IDs: user IDs are your custom text format; all other PKs are serial
//     (auto-increment integers).
//
//  7. Full-day shift: a full_day shift employee handles BOTH morning and evening
//     tasks for that store on that day. materialiseTasksForSchedule creates task
//     rows for both sets (morning morning-shift tasks + evening evening-shift tasks)
//     when it detects a full_day shift. The shiftId on each task row still points
//     to the logical shift the task belongs to (morning or evening), not full_day,
//     so the task UI can group them correctly.
//
// Morning shift tasks
// ────────────────────
//   • store_opening_tasks    (shared, morning only)
//   • setoran_tasks          (shared, morning only)
//   • cek_bin_tasks          (shared, morning — schema only, no business logic yet)
//   • product_check_tasks    (shared, morning)
//   • receiving_tasks        (shared, morning)
//
// Evening shift tasks  [discrepancy-capable]
// ────────────────────
//   • briefing_tasks         (shared, evening — checked by morning-shift employee)
//   • edc_summary_tasks      (shared, evening)
//   • edc_settlement_tasks   (shared, evening)
//   • eod_z_report_tasks     (shared, evening)
//   • open_statement_tasks   (shared, evening)
//
// Both shifts
// ────────────
//   • grooming_tasks         (personal, both shifts)
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  decimal,
  integer,
  unique,
} from 'drizzle-orm/pg-core';
import { taskStatusEnum } from './enums';
import { schedules, users, stores } from './core';
import { shifts } from './lookups';

// ─────────────────────────────────────────────────────────────────────────────
// MORNING TASKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store Opening Task  (morning, shared)
 *
 * Checklist items (boolean flags):
 *   loginPos          → Log-in POS / open cashier computer
 *   checkAbsenSunfish → Tarik & cek absen di Sunfish (verify last-day attendance)
 *   tarikSohSales     → Tarik SOH & sales
 *   fiveR             → 5R store cleaning check  ← now also has photo evidence
 *   fiveRPhotos       → JSON array of relative image paths for the 5R check
 *   cekPromo          → NEW: Cek Promo (verify current promotions are displayed)
 *   cekLamp           → Check all lights on
 *   cekSoundSystem    → Check sound system
 *
 * Photos:
 *   storeFrontPhotos  → JSON array of relative image paths
 *   cashDrawerPhotos  → JSON array of relative image paths
 */
export const storeOpeningTasks = pgTable('store_opening_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),
 
  // ── Checklist ──────────────────────────────────────────────────────────────
  loginPos:          boolean('login_pos').default(false).notNull(),
  checkAbsenSunfish: boolean('check_absen_sunfish').default(false).notNull(),
  tarikSohSales:     boolean('tarik_soh_sales').default(false).notNull(),
  fiveR:             boolean('five_r').default(false).notNull(),
  fiveRPhotos:       text('five_r_photos'),
  cekPromo:          boolean('cek_promo').default(false).notNull(),
  // ── NEW: Cek Promo photos (two buckets) ───────────────────────────────────
  cekPromoStorefrontPhotos: text('cek_promo_storefront_photos'),
  cekPromoDeskPhotos:       text('cek_promo_desk_photos'),
  cekLamp:          boolean('cek_lamp').default(false).notNull(),
  cekSoundSystem:   boolean('cek_sound_system').default(false).notNull(),
 
  // ── Photos ─────────────────────────────────────────────────────────────────
  storeFrontPhotos:  text('store_front_photos'),
  cashDrawerPhotos:  text('cash_drawer_photos'),
 
  // ── Geo ────────────────────────────────────────────────────────────────────
  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),
 
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique().on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setoran Task  (morning, shared)
 */
export const setoranTasks = pgTable('setoran_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),
 
  amount:       decimal('amount', { precision: 12, scale: 2 }),
  linkSetoran:  text('link_setoran'),
  // ── RENAMED: money_photos (JSON array) → resi_photo (single URL) ────────
  resiPhoto:    text('resi_photo'),
 
  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),
 
  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique().on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cek Bin Task  (morning, shared) — schema-only placeholder
 */
export const cekBinTasks = pgTable('cek_bin_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique().on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Product Check Task  (morning, shared)
 */
export const productCheckTasks = pgTable('product_check_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  display:     boolean('display').default(false).notNull(),
  price:       boolean('price').default(false).notNull(),
  saleTag:     boolean('sale_tag').default(false).notNull(),
  shoeFiller:  boolean('shoe_filler').default(false).notNull(),
  labelIndo:   boolean('label_indo').default(false).notNull(),
  barcode:     boolean('barcode').default(false).notNull(),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique().on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Receiving Task  (morning, shared)
 */
export const receivingTasks = pgTable('receiving_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  hasReceiving:    boolean('has_receiving').default(false).notNull(),
  receivingPhotos: text('receiving_photos'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique().on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────
// EVENING TASKS  — discrepancy-capable
//
// These tasks carry a `isBalanced` boolean (did the figures balance?) and a
// `parentTaskId` self-reference for carry-forward chains.
//
// Lifecycle:
//   pending → completed (isBalanced=true)  → verified | rejected   [normal path]
//   pending → discrepancy (isBalanced=false)
//          → next shift picks up the SAME row, re-submits
//          → completed (isBalanced=true)   → verified | rejected
//          → discrepancy again             → carries forward again …
//
// Because a discrepancy row can span multiple calendar dates, the unique
// constraint on (storeId, date) is intentionally absent from these tables.
// Tasks are correlated to a day via their `date` column for display purposes,
// but uniqueness is not enforced at the DB level — the application layer
// manages which task is "active" for a given store/shift/date.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Briefing Task  (evening, shared, discrepancy-capable)
 *
 * Done by the morning-shift handover employee for the evening shift.
 * `isBalanced` here means "briefing was acknowledged / signed off by evening crew".
 */
export const briefingTasks = pgTable('briefing_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Carry-forward chain ────────────────────────────────────────────────────
  /**
   * References the ORIGINAL task row that started this chain.
   * Null on the first row; set on every subsequent carry-forward row.
   * Allows querying the full history: WHERE id = X OR parentTaskId = X.
   */
  parentTaskId: integer('parent_task_id'), // self-ref; no FK to avoid circular dep

  // ── Data ───────────────────────────────────────────────────────────────────
  done:       boolean('done').default(false).notNull(),
  /**
   * Was the briefing acknowledged / in order?
   * false → status becomes 'discrepancy'; the task carries forward to next shift.
   * null  → not yet submitted.
   */
  isBalanced: boolean('is_balanced'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
  // NOTE: No (storeId, date) unique constraint — see table group comment above.
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * EDC Summary Task  (evening, shared, discrepancy-capable)
 *
 * `isBalanced` = EDC summary total matches expected end-of-day figure.
 */
export const edcSummaryTasks = pgTable('edc_summary_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:     integer('parent_task_id'),
  edcSummaryPhotos: text('edc_summary_photos'),
  isBalanced:       boolean('is_balanced'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * EDC Settlement Task  (evening, shared, discrepancy-capable)
 *
 * `isBalanced` = settlement total matches EDC summary.
 */
export const edcSettlementTasks = pgTable('edc_settlement_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:        integer('parent_task_id'),
  edcSettlementPhotos: text('edc_settlement_photos'),
  isBalanced:          boolean('is_balanced'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * EOD Z-Report Task  (evening, shared, discrepancy-capable)
 *
 * `isBalanced` = Z-report total matches expected sales figure.
 */
export const eodZReportTasks = pgTable('eod_z_report_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:  integer('parent_task_id'),
  zReportPhotos: text('z_report_photos'),
  isBalanced:    boolean('is_balanced'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open Statement Task  (evening, shared, discrepancy-capable)
 *
 * `isBalanced` = open statement list matches physical count.
 */
export const openStatementTasks = pgTable('open_statement_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:        integer('parent_task_id'),
  openStatementPhotos: text('open_statement_photos'),
  isBalanced:          boolean('is_balanced'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// BOTH SHIFTS — PERSONAL TASKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grooming Task  (both shifts, personal — one row per employee per shift)
 */
export const groomingTasks = pgTable('grooming_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull().unique(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  uniformActive:      boolean('uniform_active').default(true).notNull(),
  hairActive:         boolean('hair_active').default(true).notNull(),
  nailsActive:        boolean('nails_active').default(true).notNull(),
  accessoriesActive:  boolean('accessories_active').default(true).notNull(),
  shoeActive:         boolean('shoe_active').default(true).notNull(),

  uniformComplete:      boolean('uniform_complete'),
  hairGroomed:          boolean('hair_groomed'),
  nailsClean:           boolean('nails_clean'),
  accessoriesCompliant: boolean('accessories_compliant'),
  shoeCompliant:        boolean('shoe_compliant'),

  selfiePhotos: text('selfie_photos'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type StoreOpeningTask     = typeof storeOpeningTasks.$inferSelect;
export type NewStoreOpeningTask  = typeof storeOpeningTasks.$inferInsert;
export type SetoranTask          = typeof setoranTasks.$inferSelect;
export type NewSetoranTask       = typeof setoranTasks.$inferInsert;
export type CekBinTask           = typeof cekBinTasks.$inferSelect;
export type ProductCheckTask     = typeof productCheckTasks.$inferSelect;
export type ReceivingTask        = typeof receivingTasks.$inferSelect;
export type BriefingTask         = typeof briefingTasks.$inferSelect;
export type EdcSummaryTask       = typeof edcSummaryTasks.$inferSelect;
export type EdcSettlementTask    = typeof edcSettlementTasks.$inferSelect;
export type EodZReportTask       = typeof eodZReportTasks.$inferSelect;
export type OpenStatementTask    = typeof openStatementTasks.$inferSelect;
export type GroomingTask         = typeof groomingTasks.$inferSelect;
export type NewGroomingTask      = typeof groomingTasks.$inferInsert;