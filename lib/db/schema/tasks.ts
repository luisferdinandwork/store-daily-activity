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
  index,
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

  loginPos:          boolean('login_pos').default(false).notNull(),
  checkAbsenSunfish: boolean('check_absen_sunfish').default(false).notNull(),
  tarikSohSales:     boolean('tarik_soh_sales').default(false).notNull(),
  fiveR:             boolean('five_r').default(false).notNull(),

  fiveRAreaKasirPhotos:  text('five_r_area_kasir_photos'),
  fiveRAreaDepanPhotos:  text('five_r_area_depan_photos'),
  fiveRAreaKananPhotos:  text('five_r_area_kanan_photos'),
  fiveRAreaKiriPhotos:   text('five_r_area_kiri_photos'),
  fiveRAreaGudangPhotos: text('five_r_area_gudang_photos'),

  cekLamp:        boolean('cek_lamp').default(false).notNull(),
  cekSoundSystem: boolean('cek_sound_system').default(false).notNull(),

  cashDrawerPhotos: text('cash_drawer_photos'),

  loginPosBy: text('login_pos_by').references(() => users.id),
  loginPosAt: timestamp('login_pos_at'),

  checkAbsenSunfishBy: text('check_absen_sunfish_by').references(() => users.id),
  checkAbsenSunfishAt: timestamp('check_absen_sunfish_at'),

  tarikSohSalesBy: text('tarik_soh_sales_by').references(() => users.id),
  tarikSohSalesAt: timestamp('tarik_soh_sales_at'),

  fiveRBy: text('five_r_by').references(() => users.id),
  fiveRAt: timestamp('five_r_at'),

  fiveRAreaKasirBy: text('five_r_kasir_by').references(() => users.id),
  fiveRAreaKasirAt: timestamp('five_r_kasir_at'),

  fiveRAreaDepanBy: text('five_r_depan_by').references(() => users.id),
  fiveRAreaDepanAt: timestamp('five_r_depan_at'),

  fiveRAreaKananBy: text('five_r_kanan_by').references(() => users.id),
  fiveRAreaKananAt: timestamp('five_r_kanan_at'),

  fiveRAreaKiriBy: text('five_r_kiri_by').references(() => users.id),
  fiveRAreaKiriAt: timestamp('five_r_kiri_at'),

  fiveRAreaGudangBy: text('five_r_gudang_by').references(() => users.id),
  fiveRAreaGudangAt: timestamp('five_r_gudang_at'),

  cekLampBy: text('cek_lamp_by').references(() => users.id),
  cekLampAt: timestamp('cek_lamp_at'),

  cekSoundSystemBy: text('cek_sound_system_by').references(() => users.id),
  cekSoundSystemAt: timestamp('cek_sound_system_at'),

  cashDrawerBy: text('cash_drawer_by').references(() => users.id),
  cashDrawerAt: timestamp('cash_drawer_at'),

  completedBy: text('completed_by').references(() => users.id),
  completedByScheduleId: integer('completed_by_schedule_id').references(() => schedules.id),

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
  uniqStoreDate: unique('store_opening_tasks_store_date_unique').on(t.storeId, t.date),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store Front Task  (morning, shared)
 */
export const storeFrontTasks = pgTable('store_front_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),
 
  // JSON array of URLs — min 1 max 3
  // Both staff should appear in at least one photo together in front of the store
  storefrontPhotos:       text('storefront_photos'),
  rollingDoorClosedPhoto: text('rolling_door_closed_photo'),

  claimedBy: text('claimed_by').references(() => users.id),
  claimedAt: timestamp('claimed_at', { mode: 'date' }),
  completedBy: text('completed_by').references(() => users.id),
  completedByScheduleId: integer('completed_by_schedule_id').references(() => schedules.id),
 
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
  uniqStoreDate: unique('store_front_tasks_store_date_unique').on(t.storeId, t.date),
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

  actualReceivedAmountBy: text('actual_received_amount_by').references(() => users.id),
  actualReceivedAmountAt: timestamp('actual_received_amount_at', { mode: 'date' }),
  storedAmountBy: text('stored_amount_by').references(() => users.id),
  storedAmountAt: timestamp('stored_amount_at', { mode: 'date' }),
  resiPhotoBy: text('resi_photo_by').references(() => users.id),
  resiPhotoAt: timestamp('resi_photo_at', { mode: 'date' }),
  atmCardSelfiePhotoBy: text('atm_card_selfie_photo_by').references(() => users.id),
  atmCardSelfiePhotoAt: timestamp('atm_card_selfie_photo_at', { mode: 'date' }),
  notesBy: text('notes_by').references(() => users.id),
  notesAt: timestamp('notes_at', { mode: 'date' }),
  completedBy: text('completed_by').references(() => users.id),
  completedByScheduleId: integer('completed_by_schedule_id').references(() => schedules.id),

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
  uniqStoreDate: unique('setoran_tasks_store_date_unique').on(t.storeId, t.date),
}));

export const setoranMoneyStorage = pgTable('setoran_money_storage', {
  id: serial('id').primaryKey(),

  taskId: integer('task_id')
    .references(() => setoranTasks.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),

  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  storeId: integer('store_id').references(() => stores.id).notNull(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  date: timestamp('date').notNull(),

  // Uang aktual yang diterima store hari itu.
  // Backward compatible with old setoranTasks.expectedAmount.
  actualReceivedAmount: decimal('actual_received_amount', { precision: 12, scale: 2 }).notNull(),

  // Unpaid dari setoran sebelumnya.
  previousUnpaidAmount: decimal('previous_unpaid_amount', { precision: 12, scale: 2 }).default('0').notNull(),

  // actualReceivedAmount + previousUnpaidAmount.
  requiredStoreAmount: decimal('required_store_amount', { precision: 12, scale: 2 }).notNull(),

  // Uang aktual yang disetor/disimpan hari itu.
  // Backward compatible with old setoranTasks.amount.
  storedAmount: decimal('stored_amount', { precision: 12, scale: 2 }).notNull(),

  // requiredStoreAmount - storedAmount. This becomes the next morning carry-forward.
  unpaidAmount: decimal('unpaid_amount', { precision: 12, scale: 2 }).default('0').notNull(),

  resiPhoto: text('resi_photo'),
  atmCardSelfiePhoto: text('atm_card_selfie_photo'),
  notes: text('notes'),
  
  actualReceivedAmountBy: text('actual_received_amount_by').references(() => users.id),
  actualReceivedAmountAt: timestamp('actual_received_amount_at', { mode: 'date' }),
  storedAmountBy: text('stored_amount_by').references(() => users.id),
  storedAmountAt: timestamp('stored_amount_at', { mode: 'date' }),
  resiPhotoBy: text('resi_photo_by').references(() => users.id),
  resiPhotoAt: timestamp('resi_photo_at', { mode: 'date' }),
  atmCardSelfiePhotoBy: text('atm_card_selfie_photo_by').references(() => users.id),
  atmCardSelfiePhotoAt: timestamp('atm_card_selfie_photo_at', { mode: 'date' }),
  notesBy: text('notes_by').references(() => users.id),
  notesAt: timestamp('notes_at', { mode: 'date' }),
  completedBy: text('completed_by').references(() => users.id),
  completedByScheduleId: integer('completed_by_schedule_id').references(() => schedules.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique('setoran_money_storage_store_date_unique').on(t.storeId, t.date),
  storeDateIdx: index('setoran_money_storage_store_date_idx').on(t.storeId, t.date),
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
  date:       timestamp('date', { mode: 'date' }).notNull(),

  // Snapshot from store_bins at the time the task is created/submitted.
  totalStoreBins:      integer('total_store_bins').default(0).notNull(),
  minimumBinsToCheck:  integer('minimum_bins_to_check').default(0).notNull(),
  checkedBinsCount:    integer('checked_bins_count').default(0).notNull(),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at', { mode: 'date' }),
  createdAt:   timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  uniqStoreDate: unique('cek_bin_tasks_store_date_unique').on(t.storeId, t.date),
  storeDateIdx: index('cek_bin_tasks_store_date_idx').on(t.storeId, t.date),
}));

export const storeBins = pgTable('store_bins', {
  id:      serial('id').primaryKey(),
  storeId: integer('store_id').references(() => stores.id).notNull(),

  // User requested columns:
  // BIN | QTY BC | QTY SESUAI BIN | QTY TIDAK SESUAI BIN | NAMA
  bin:                text('bin').notNull(),
  qtyBc:              integer('qty_bc').default(0).notNull(),
  qtySesuaiBin:       integer('qty_sesuai_bin').default(0).notNull(),
  qtyTidakSesuaiBin:  integer('qty_tidak_sesuai_bin').default(0).notNull(),
  nama:               text('nama').notNull(),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  uniqStoreBin: unique('store_bins_store_bin_unique').on(t.storeId, t.bin),
  storeIdx: index('store_bins_store_idx').on(t.storeId),
}));

export const cekBinTaskBins = pgTable('cek_bin_task_bins', {
  id:     serial('id').primaryKey(),
  taskId: integer('task_id')
    .references(() => cekBinTasks.id, { onDelete: 'cascade' })
    .notNull(),

  binId: integer('bin_id')
    .references(() => storeBins.id)
    .notNull(),

  // Snapshot of master data, so historical task stays readable even if bin master changes.
  bin:  text('bin').notNull(),
  nama: text('nama').notNull(),

  // These are the checked quantities filled/submitted for that selected bin.
  qtyBc:             integer('qty_bc').default(0).notNull(),
  qtySesuaiBin:      integer('qty_sesuai_bin').default(0).notNull(),
  qtyTidakSesuaiBin: integer('qty_tidak_sesuai_bin').default(0).notNull(),

  notes: text('notes'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  uniqTaskBin: unique('cek_bin_task_bins_task_bin_unique').on(t.taskId, t.binId),
  taskIdx: index('cek_bin_task_bins_task_idx').on(t.taskId),
}));


// ─────────────────────────────────────────────────────────────────────────────

/**
 * VM Checklist Task  (morning, shared)
 */
export const vmChecklistTasks = pgTable('vm_checklist_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  shoeLaceShoeFillerPriceTagHangtagLabelK3L:
    boolean('shoe_lace_shoe_filler_price_tag_hangtag_label_k3l').default(false).notNull(),

  lastPairAndPigskinHangtag:
    boolean('last_pair_and_pigskin_hangtag').default(false).notNull(),

  popPromoUpdate:
    boolean('pop_promo_update').default(false).notNull(),

  displayTableWallShelvingShowcaseHangbarStackingPedestal:
    boolean('display_table_wall_shelving_showcase_hangbar_stacking_pedestal').default(false).notNull(),

  floorDisplayCleanliness:
    boolean('floor_display_cleanliness').default(false).notNull(),

  vmToolsStorage:
    boolean('vm_tools_storage').default(false).notNull(),

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
  uniqStoreDate: unique('vm_checklist_tasks_store_date_unique').on(t.storeId, t.date),
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
  quantity:       integer('quantity').default(0).notNull(),
  dropTime:       timestamp('drop_time').notNull(),
  droppingPhotos: text('dropping_photos'),
  notes:          text('notes'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Marketing Check Task  (morning)
 */
export const marketingCheckTasks = pgTable('marketing_check_tasks', {
  id: serial('id').primaryKey(),

  scheduleId: integer('schedule_id')
    .notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),

  userId: text('user_id')
    .notNull()
    .references(() => users.id),

  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),

  shiftId: integer('shift_id')
    .notNull()
    .references(() => shifts.id),

  date: timestamp('date', { mode: 'date' }).notNull(),

  promoName: boolean('promo_name').default(false).notNull(),
  promoPeriod: boolean('promo_period').default(false).notNull(),
  promoMechanism: boolean('promo_mechanism').default(false).notNull(),
  randomShoeItems: boolean('random_shoe_items').default(false).notNull(),
  randomNonShoeItems: boolean('random_non_shoe_items').default(false).notNull(),
  sellTag: boolean('sell_tag').default(false).notNull(),

  promoNameBy: text('promo_name_by').references(() => users.id),
  promoNameAt: timestamp('promo_name_at'),

  promoPeriodBy: text('promo_period_by').references(() => users.id),
  promoPeriodAt: timestamp('promo_period_at'),

  promoMechanismBy: text('promo_mechanism_by').references(() => users.id),
  promoMechanismAt: timestamp('promo_mechanism_at'),

  randomShoeItemsBy: text('random_shoe_items_by').references(() => users.id),
  randomShoeItemsAt: timestamp('random_shoe_items_at'),

  randomNonShoeItemsBy: text('random_non_shoe_items_by').references(() => users.id),
  randomNonShoeItemsAt: timestamp('random_non_shoe_items_at'),

  sellTagBy: text('sell_tag_by').references(() => users.id),
  sellTagAt: timestamp('sell_tag_at'),

  notesBy: text('notes_by').references(() => users.id),
  notesAt: timestamp('notes_at'),

  completedBy: text('completed_by').references(() => users.id),
  completedByScheduleId: integer('completed_by_schedule_id').references(() => schedules.id),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status: taskStatusEnum('status').default('pending').notNull(),

  notes: text('notes'),

  completedAt: timestamp('completed_at', { mode: 'date' }),
  verifiedBy: text('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { mode: 'date' }),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  uniqueSchedule: unique('marketing_check_tasks_schedule_id_unique').on(t.scheduleId),
  uniqueStoreDateShift: unique('marketing_check_tasks_store_date_shift_unique').on(
    t.storeId,
    t.date,
    t.shiftId,
  ),
}));

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

// ─── Inferred types ───────────────────────────────────────────────────────────

export type StoreOpeningTask      = typeof storeOpeningTasks.$inferSelect;
export type NewStoreOpeningTask   = typeof storeOpeningTasks.$inferInsert;

export type SetoranTask           = typeof setoranTasks.$inferSelect;
export type NewSetoranTask        = typeof setoranTasks.$inferInsert;
export type SetoranMoneyStorage = typeof setoranMoneyStorage.$inferSelect;
export type NewSetoranMoneyStorage = typeof setoranMoneyStorage.$inferInsert;

export type CekBinTask            = typeof cekBinTasks.$inferSelect;
export type NewCekBinTask         = typeof cekBinTasks.$inferInsert;
export type StoreBin              = typeof storeBins.$inferSelect;
export type NewStoreBin           = typeof storeBins.$inferInsert;
export type CekBinTaskBin         = typeof cekBinTaskBins.$inferSelect;
export type NewCekBinTaskBin      = typeof cekBinTaskBins.$inferInsert;

// VM types
export type VmChecklistTask       = typeof vmChecklistTasks.$inferSelect;
export type NewVmChecklistTask    = typeof vmChecklistTasks.$inferInsert;
export type VMChecklistTask       = VmChecklistTask;
export type NewVMChecklistTask    = NewVmChecklistTask;

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
export type EdcReconciliationTask    = typeof edcReconciliationTasks.$inferSelect;
export type NewEdcReconciliationTask = typeof edcReconciliationTasks.$inferInsert;
export type EdcTransactionRow        = typeof edcTransactionRows.$inferSelect;
export type NewEdcTransactionRow     = typeof edcTransactionRows.$inferInsert;
export type MarketingCheckTask    = typeof marketingCheckTasks.$inferSelect;
export type NewMarketingCheckTask = typeof marketingCheckTasks.$inferInsert;
export type StoreFrontTask        = typeof storeFrontTasks.$inferSelect;
export type NewStoreFrontTask     = typeof storeFrontTasks.$inferInsert;
