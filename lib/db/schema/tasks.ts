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
//                    Unique constraint on (storeId, date, shift).
//       - Personal → one row per employee per shift (e.g. grooming).
//                    Unique constraint on (scheduleId).
//
//  5. IDs: user IDs are your custom text format; all other PKs are serial
//     (auto-increment integers).
//
// Morning shift tasks
// ────────────────────
//   • store_opening_tasks    (shared, morning only)
//   • setoran_tasks          (shared, morning only)
//   • cek_bin_tasks          (shared, morning — schema only, no business logic yet)
//   • product_check_tasks    (shared, morning)
//   • receiving_tasks        (shared, morning)
//
// Evening shift tasks
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

// ─── Shared base columns helper ───────────────────────────────────────────────
// Not a real table; we repeat these columns per table because Drizzle ORM
// does not support table inheritance.  This comment documents the pattern.
//
// Each task has:
//   id            serial PK
//   scheduleId    → who triggered this row (employee+shift+date)
//   userId        → employee responsible
//   storeId       → which store
//   shift         morning | evening
//   date          midnight of the working day
//   status        pending → in_progress → completed → verified | rejected
//   completedAt   when employee submitted
//   verifiedBy    ops/pic1 who approved
//   verifiedAt
//   submittedLat  geo at submission
//   submittedLng
//   notes         free-text
//   createdAt / updatedAt

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
 *   fiveR             → 5R store cleaning check
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

  loginPos:          boolean('login_pos').default(false).notNull(),
  checkAbsenSunfish: boolean('check_absen_sunfish').default(false).notNull(),
  tarikSohSales:     boolean('tarik_soh_sales').default(false).notNull(),
  fiveR:             boolean('five_r').default(false).notNull(),
  cekLamp:           boolean('cek_lamp').default(false).notNull(),
  cekSoundSystem:    boolean('cek_sound_system').default(false).notNull(),

  storeFrontPhotos: text('store_front_photos'),
  cashDrawerPhotos: text('cash_drawer_photos'),

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
 * Setoran Task  (morning, shared)
 *
 * The employee records the day's cash handover to the company.
 * Evidence: photo of the physical money + the transfer link.
 */
export const setoranTasks = pgTable('setoran_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Data ───────────────────────────────────────────────────────────────────
  amount:       decimal('amount', { precision: 12, scale: 2 }),  // nominal setoran
  linkSetoran:  text('link_setoran'),                            // transfer receipt URL / ref
  moneyPhotos:  text('money_photos'),                            // JSON: string[] of local paths

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
 * Cek Bin Task  (morning, shared)
 *
 * Schema-only placeholder — business logic not implemented yet.
 * Add columns here as requirements become clear.
 */
export const cekBinTasks = pgTable('cek_bin_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

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
 * Product Check Task  (morning, shared)
 *
 * Checklist: Display / Price / Sale Tag / Shoe-filler / Label Indo / Barcode.
 * One row per store per day — any morning-shift employee can fill it in.
 */
export const productCheckTasks = pgTable('product_check_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Checklist ──────────────────────────────────────────────────────────────
  display:     boolean('display').default(false).notNull(),
  price:       boolean('price').default(false).notNull(),
  saleTag:     boolean('sale_tag').default(false).notNull(),
  shoeFiller:  boolean('shoe_filler').default(false).notNull(),
  labelIndo:   boolean('label_indo').default(false).notNull(),
  barcode:     boolean('barcode').default(false).notNull(),

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
 * Receiving Task  (morning, shared)
 *
 * Records whether a stock delivery arrived that day.
 * `hasReceiving` = false means the employee actively confirmed "no delivery today".
 * When true, the employee can attach photos of the received goods.
 */
export const receivingTasks = pgTable('receiving_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Data ───────────────────────────────────────────────────────────────────
  hasReceiving:   boolean('has_receiving').default(false).notNull(),
  receivingPhotos: text('receiving_photos'),  // JSON: string[] — only when hasReceiving=true

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
// EVENING TASKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Briefing Task  (evening, shared)
 *
 * Done by the morning-shift handover employee for the evening shift.
 * Just a single "done" checkbox — no photos required.
 */
export const briefingTasks = pgTable('briefing_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  /**
   * userId here is the morning-shift employee who conducted the briefing
   * (not the evening-shift employee receiving it).
   */
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Data ───────────────────────────────────────────────────────────────────
  done: boolean('done').default(false).notNull(),

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
 * EDC Summary Task  (evening, shared)
 * Employee photographs the EDC machine summary printout.
 */
export const edcSummaryTasks = pgTable('edc_summary_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── Photos ─────────────────────────────────────────────────────────────────
  edcSummaryPhotos: text('edc_summary_photos'),  // JSON: string[]

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
 * EDC Settlement Task  (evening, shared)
 */
export const edcSettlementTasks = pgTable('edc_settlement_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  edcSettlementPhotos: text('edc_settlement_photos'),  // JSON: string[]

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
 * EOD Z-Report Task  (evening, shared)
 */
export const eodZReportTasks = pgTable('eod_z_report_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  zReportPhotos: text('z_report_photos'),  // JSON: string[]

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
 * Open Statement List Task  (evening, shared)
 */
export const openStatementTasks = pgTable('open_statement_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  openStatementPhotos: text('open_statement_photos'),  // JSON: string[]

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
// BOTH SHIFTS — PERSONAL TASKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grooming Task  (both shifts, personal — one row per employee per shift)
 *
 * The OPS team defines which checklist items are active via boolean flags
 * (true = item is enabled by ops; false = item disabled/hidden for now).
 * The employee then fills in whether they comply (also boolean).
 *
 * Current checklist items (all yes/no):
 *   uniformComplete       → Uniform lengkap
 *   hairGroomed           → Rambut rapi
 *   nailsClean            → Kuku bersih
 *   accessoriesCompliant  → Aksesoris sesuai standar
 *   shoeCompliant         → Sepatu sesuai standar
 *
 * Photos:
 *   selfiePhotos          → full-body photo(s), JSON array of local paths
 */
export const groomingTasks = pgTable('grooming_tasks', {
  id:         serial('id').primaryKey(),
scheduleId: integer('schedule_id').references(() => schedules.id).notNull().unique(),  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // ── OPS-controlled activation flags ───────────────────────────────────────
  // When false, that item is hidden from the employee's form.
  uniformActive:      boolean('uniform_active').default(true).notNull(),
  hairActive:         boolean('hair_active').default(true).notNull(),
  nailsActive:        boolean('nails_active').default(true).notNull(),
  accessoriesActive:  boolean('accessories_active').default(true).notNull(),
  shoeActive:         boolean('shoe_active').default(true).notNull(),

  // ── Employee compliance answers ────────────────────────────────────────────
  uniformComplete:      boolean('uniform_complete'),
  hairGroomed:          boolean('hair_groomed'),
  nailsClean:           boolean('nails_clean'),
  accessoriesCompliant: boolean('accessories_compliant'),
  shoeCompliant:        boolean('shoe_compliant'),

  // ── Photos ─────────────────────────────────────────────────────────────────
  selfiePhotos: text('selfie_photos'),  // JSON: string[]

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