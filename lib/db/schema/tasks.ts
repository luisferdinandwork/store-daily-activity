// lib/db/schema/tasks.ts
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
import { taskStatusEnum, txTypeEnum } from './enums';
import { schedules, users, stores } from './core';
import { shifts } from './lookups';

// ─────────────────────────────────────────────────────────────────────────────
// MORNING TASKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store Opening Task  (morning, shared)
 *
 * Checklist items:
 *   loginPos          → Log-in POS / open cashier computer  (+ cashierDesk photos)
 *   checkAbsenSunfish → Tarik & cek absen di Sunfish
 *   tarikSohSales     → Tarik SOH & sales
 *   fiveR             → 5R store cleaning check
 *                        Each of the 5 areas requires min 1, max 2 photos:
 *                          fiveRAreaKasirPhotos     – Area Kasir
 *                          fiveRAreaDepanPhotos     – Depan Toko
 *                          fiveRAreaKananPhotos     – Sisi Kanan
 *                          fiveRAreaKiriPhotos      – Sisi Kiri
 *                          fiveRAreaGudangPhotos    – Gudang
 *   cekLamp           → Check all lights on
 *   cekSoundSystem    → Check sound system
 *
 * Photos (non-checklist):
 *   storeFrontPhotos  → JSON array, min 1 max 3
 *   cashDrawerPhotos  → JSON array, min 1 max 2  (repurposed for cashier desk)
 *
 * NOTE: cekBanner and all banner photo columns have been removed.
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

  // ── 5R area photos (each area: min 1, max 2) ──────────────────────────────
  fiveRAreaKasirPhotos:  text('five_r_area_kasir_photos'),   // Area Kasir
  fiveRAreaDepanPhotos:  text('five_r_area_depan_photos'),   // Depan Toko
  fiveRAreaKananPhotos:  text('five_r_area_kanan_photos'),   // Sisi Kanan
  fiveRAreaKiriPhotos:   text('five_r_area_kiri_photos'),    // Sisi Kiri
  fiveRAreaGudangPhotos: text('five_r_area_gudang_photos'),  // Gudang

  cekLamp:        boolean('cek_lamp').default(false).notNull(),
  cekSoundSystem: boolean('cek_sound_system').default(false).notNull(),

  // ── Photos (non-checklist) ─────────────────────────────────────────────────
  storeFrontPhotos: text('store_front_photos'),
  cashDrawerPhotos: text('cash_drawer_photos'),   // cashier desk photos

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

  expectedAmount:          decimal('expected_amount',           { precision: 12, scale: 2 }),
  carriedDeficit:          decimal('carried_deficit',           { precision: 12, scale: 2 }).default('0').notNull(),
  carriedDeficitFetchedAt: timestamp('carried_deficit_fetched_at'),
  amount:                  decimal('amount',                    { precision: 12, scale: 2 }),
  resiPhoto:               text('resi_photo'),
  atmCardSelfiePhoto:      text('atm_card_selfie_photo'),
  unpaidAmount:            decimal('unpaid_amount',             { precision: 12, scale: 2 }).default('0').notNull(),

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

  display:    boolean('display').default(false).notNull(),
  price:      boolean('price').default(false).notNull(),
  saleTag:    boolean('sale_tag').default(false).notNull(),
  shoeFiller: boolean('shoe_filler').default(false).notNull(),
  labelIndo:  boolean('label_indo').default(false).notNull(),
  barcode:    boolean('barcode').default(false).notNull(),

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
export const itemDroppingTasks = pgTable('item_dropping_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  hasDropping: boolean('has_dropping').default(false).notNull(),

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

export const itemDroppingEntries = pgTable('item_dropping_entries', {
  id:             serial('id').primaryKey(),
  taskId:         integer('task_id').references(() => itemDroppingTasks.id, { onDelete: 'cascade' }).notNull(),
  userId:         text('user_id').references(() => users.id).notNull(),
  storeId:        integer('store_id').references(() => stores.id).notNull(),
  toNumber:       text('to_number').notNull(),
  dropTime:       timestamp('drop_time').notNull(),
  droppingPhotos: text('dropping_photos'),
  notes:          text('notes'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENING TASKS  — discrepancy-capable
// ─────────────────────────────────────────────────────────────────────────────

export const briefingTasks = pgTable('briefing_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId: integer('parent_task_id'),

  done:       boolean('done').default(false).notNull(),
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
});

// ─────────────────────────────────────────────────────────────────────────────

export const edcReconciliationTasks = pgTable('edc_reconciliation_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:      integer('parent_task_id'),
  expectedFetchedAt: timestamp('expected_fetched_at'),
  expectedSnapshot:  text('expected_snapshot'),
  isBalanced:        boolean('is_balanced'),

  discrepancyStartedAt:       timestamp('discrepancy_started_at'),
  discrepancyResolvedAt:      timestamp('discrepancy_resolved_at'),
  discrepancyDurationMinutes: integer('discrepancy_duration_minutes'),

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

export const edcTransactionRows = pgTable('edc_transaction_rows', {
  id:        serial('id').primaryKey(),
  edcTaskId: integer('edc_task_id').references(() => edcReconciliationTasks.id, { onDelete: 'cascade' }).notNull(),

  transactionType: txTypeEnum('transaction_type').notNull(),

  expectedAmount: decimal('expected_amount', { precision: 14, scale: 2 }),
  expectedCount:  integer('expected_count'),
  actualAmount:   decimal('actual_amount',   { precision: 14, scale: 2 }),
  actualCount:    integer('actual_count'),
  matches:        boolean('matches'),

  notes:     text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

export const eodZReportTasks = pgTable('eod_z_report_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  totalNominal:  decimal('total_nominal', { precision: 14, scale: 2 }),
  zReportPhotos: text('z_report_photos'),

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

export const openStatementTasks = pgTable('open_statement_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  parentTaskId:      integer('parent_task_id'),
  expectedAmount:    decimal('expected_amount',    { precision: 14, scale: 2 }),
  expectedFetchedAt: timestamp('expected_fetched_at'),
  actualAmount:      decimal('actual_amount',      { precision: 14, scale: 2 }),
  isBalanced:        boolean('is_balanced'),

  discrepancyStartedAt:       timestamp('discrepancy_started_at'),
  discrepancyResolvedAt:      timestamp('discrepancy_resolved_at'),
  discrepancyDurationMinutes: integer('discrepancy_duration_minutes'),

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

export const groomingTasks = pgTable('grooming_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull().unique(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  uniformActive:   boolean('uniform_active').default(true).notNull(),
  hairActive:      boolean('hair_active').default(true).notNull(),
  smellActive:     boolean('smell_active').default(true).notNull(),
  makeUpActive:    boolean('make_up_active').default(true).notNull(),
  shoeActive:      boolean('shoe_active').default(true).notNull(),
  nameTagActive:   boolean('name_tag_active').default(true).notNull(),

  uniformChecked:  boolean('uniform_checked'),
  hairChecked:     boolean('hair_checked'),
  smellChecked:    boolean('smell_checked'),
  makeUpChecked:   boolean('make_up_checked'),
  shoeChecked:     boolean('shoe_checked'),
  nameTagChecked:  boolean('name_tag_checked'),

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

export const marketingCheckTasks = pgTable('marketing_check_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // Cek promo berjalan
  promoName:      boolean('promo_name').default(false).notNull(),
  promoPeriod:    boolean('promo_period').default(false).notNull(),
  promoMechanism: boolean('promo_mechanism').default(false).notNull(),

  // Random checking
  randomShoeItems:    boolean('random_shoe_items').default(false).notNull(),
  randomNonShoeItems: boolean('random_non_shoe_items').default(false).notNull(),

  // Sell tag
  sellTag: boolean('sell_tag').default(false).notNull(),

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
  uniqStoreShiftDate: unique().on(t.storeId, t.shiftId, t.date),
}));

// ─── Inferred types ───────────────────────────────────────────────────────────

export type StoreOpeningTask      = typeof storeOpeningTasks.$inferSelect;
export type NewStoreOpeningTask   = typeof storeOpeningTasks.$inferInsert;
export type SetoranTask           = typeof setoranTasks.$inferSelect;
export type NewSetoranTask        = typeof setoranTasks.$inferInsert;
export type CekBinTask            = typeof cekBinTasks.$inferSelect;
export type ProductCheckTask      = typeof productCheckTasks.$inferSelect;
export type ItemDroppingTask      = typeof itemDroppingTasks.$inferSelect;
export type NewItemDroppingTask   = typeof itemDroppingTasks.$inferInsert;
export type ItemDroppingEntry     = typeof itemDroppingEntries.$inferSelect;
export type NewItemDroppingEntry  = typeof itemDroppingEntries.$inferInsert;
export type BriefingTask          = typeof briefingTasks.$inferSelect;
export type EodZReportTask        = typeof eodZReportTasks.$inferSelect;
export type NewEodZReportTask     = typeof eodZReportTasks.$inferInsert;
export type OpenStatementTask     = typeof openStatementTasks.$inferSelect;
export type NewOpenStatementTask  = typeof openStatementTasks.$inferInsert;
export type GroomingTask          = typeof groomingTasks.$inferSelect;
export type NewGroomingTask       = typeof groomingTasks.$inferInsert;
export type MarketingCheckTask    = typeof marketingCheckTasks.$inferSelect;
export type NewMarketingCheckTask = typeof marketingCheckTasks.$inferInsert;
export type EdcReconciliationTask    = typeof edcReconciliationTasks.$inferSelect;
export type NewEdcReconciliationTask = typeof edcReconciliationTasks.$inferInsert;
export type EdcTransactionRow        = typeof edcTransactionRows.$inferSelect;
export type NewEdcTransactionRow     = typeof edcTransactionRows.$inferInsert;