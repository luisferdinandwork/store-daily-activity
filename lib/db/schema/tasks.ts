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
import { taskStatusEnum } from './enums';
import { schedules, users, stores, issues } from './core';
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
  fiveRAreaKasirPhotoActors: text('five_r_area_kasir_photo_actors'),

  fiveRAreaDepanBy: text('five_r_depan_by').references(() => users.id),
  fiveRAreaDepanAt: timestamp('five_r_depan_at'),
  fiveRAreaDepanPhotoActors: text('five_r_area_depan_photo_actors'),

  fiveRAreaKananBy: text('five_r_kanan_by').references(() => users.id),
  fiveRAreaKananAt: timestamp('five_r_kanan_at'),
  fiveRAreaKananPhotoActors: text('five_r_area_kanan_photo_actors'),

  fiveRAreaKiriBy: text('five_r_kiri_by').references(() => users.id),
  fiveRAreaKiriAt: timestamp('five_r_kiri_at'),
  fiveRAreaKiriPhotoActors: text('five_r_area_kiri_photo_actors'),

  fiveRAreaGudangBy: text('five_r_gudang_by').references(() => users.id),
  fiveRAreaGudangAt: timestamp('five_r_gudang_at'),
  fiveRAreaGudangPhotoActors: text('five_r_area_gudang_photo_actors'),

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
}, (table) => ({
  uniqueStoreDateShift: unique('item_dropping_tasks_store_date_shift_unique')
    .on(table.storeId, table.date, table.shiftId),
}));

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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Item Return Task (morning, shared)
 *
 * Similar to Item Dropping, but this records return documents/items that need
 * to be processed by the store. The available return list can come from BC via
 * the employee API, then employees confirm each return with photos and time.
 */
export const itemReturnTasks = pgTable('item_return_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  hasReturn: boolean('has_return').default(false).notNull(),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueStoreDateShift: unique('item_return_tasks_store_date_shift_unique')
    .on(table.storeId, table.date, table.shiftId),
  storeDateIdx: index('item_return_tasks_store_date_idx')
    .on(table.storeId, table.date),
}));

export const itemReturnEntries = pgTable('item_return_entries', {
  id:           serial('id').primaryKey(),
  taskId:       integer('task_id').references(() => itemReturnTasks.id, { onDelete: 'cascade' }).notNull(),
  userId:       text('user_id').references(() => users.id).notNull(),
  storeId:      integer('store_id').references(() => stores.id).notNull(),

  returnNumber: text('return_number').notNull(),
  description:  text('description'),
  expectedAt:   timestamp('expected_at'),
  quantity:     integer('quantity').default(0).notNull(),
  returnTime:   timestamp('return_time').notNull(),
  returnPhotos: text('return_photos'),
  notes:        text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  taskIdx: index('item_return_entries_task_idx').on(table.taskId),
  returnNumberIdx: index('item_return_entries_return_number_idx').on(table.returnNumber),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cek Uang Muka Task (morning, shared)
 *
 * This stores the ready cashier float/opening cash by denomination. Amount is
 * calculated server-side from denominationValue × quantity, so client-side
 * totals cannot corrupt the task.
 */
export const cekUangMukaTasks = pgTable('cek_uang_muka_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  /** Total cash counted from all denomination rows. */
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0').notNull(),

  /** Daily cashier float cap. Stored for future OPS reports even if the cap changes later. */
  maxAmount: decimal('max_amount', { precision: 12, scale: 2 }).default('500000').notNull(),

  /** maxAmount - totalAmount. Useful for OPS daily/monthly reporting. */
  remainingAmount: decimal('remaining_amount', { precision: 12, scale: 2 }).default('500000').notNull(),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueStoreDateShift: unique('cek_uang_muka_tasks_store_date_shift_unique')
    .on(table.storeId, table.date, table.shiftId),
  storeDateIdx: index('cek_uang_muka_tasks_store_date_idx')
    .on(table.storeId, table.date),
  statusIdx: index('cek_uang_muka_tasks_status_idx').on(table.status),
}));

export const cekUangMukaDenominations = pgTable('cek_uang_muka_denominations', {
  id:                serial('id').primaryKey(),
  taskId:            integer('task_id').references(() => cekUangMukaTasks.id, { onDelete: 'cascade' }).notNull(),
  userId:            text('user_id').references(() => users.id).notNull(),
  storeId:           integer('store_id').references(() => stores.id).notNull(),
  denominationValue: integer('denomination_value').notNull(),
  quantity:          integer('quantity').default(0).notNull(),
  amount:            decimal('amount', { precision: 12, scale: 2 }).default('0').notNull(),
  notes:             text('notes'),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  updatedAt:         timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueTaskDenomination: unique('cek_uang_muka_task_denomination_unique')
    .on(table.taskId, table.denominationValue),
  taskIdx: index('cek_uang_muka_denominations_task_idx').on(table.taskId),
}));

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
}, (table) => ({
  uniqueStoreDateShift: unique('briefing_tasks_store_date_shift_unique')
    .on(table.storeId, table.date, table.shiftId),
}));

// ─────────────────────────────────────────────────────────────────────────────

export const serahTerimaTasks = pgTable('serah_terima_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  /**
   * Free-text input written by the current shift.
   * Backend splits this into serah_terima_items so the next shift can tick
   * each message/action independently.
   */
  handoverText: text('handover_text'),

  submittedLat: decimal('submitted_lat', { precision: 10, scale: 7 }),
  submittedLng: decimal('submitted_lng', { precision: 10, scale: 7 }),

  status:      taskStatusEnum('status').default('pending').notNull(),
  notes:       text('notes'),
  completedAt: timestamp('completed_at'),
  verifiedBy:  text('verified_by').references(() => users.id),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  scheduleShiftUnique: unique('serah_terima_tasks_schedule_shift_unique')
    .on(table.scheduleId, table.shiftId),
  storeDateShiftUnique: unique('serah_terima_tasks_store_date_shift_unique')
    .on(table.storeId, table.date, table.shiftId),
  storeDateShiftIdx: index('serah_terima_tasks_store_date_shift_idx')
    .on(table.storeId, table.date, table.shiftId),
}));

export const serahTerimaItems = pgTable('serah_terima_items', {
  id:     serial('id').primaryKey(),
  taskId: integer('task_id')
    .references(() => serahTerimaTasks.id, { onDelete: 'cascade' })
    .notNull(),

  /**
   * The task that receives this message.
   * It is filled when the next shift task exists/materialises.
   */
  receiverTaskId: integer('receiver_task_id'),

  storeId:     integer('store_id').references(() => stores.id).notNull(),
  sourceUserId:text('source_user_id').references(() => users.id).notNull(),
  targetShiftId: integer('target_shift_id').references(() => shifts.id).notNull(),

  message: text('message').notNull(),

  isCompleted: boolean('is_completed').default(false).notNull(),
  completedBy: text('completed_by').references(() => users.id),
  completedAt: timestamp('completed_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  taskIdx: index('serah_terima_items_task_idx').on(table.taskId),
  receiverTaskIdx: index('serah_terima_items_receiver_task_idx').on(table.receiverTaskId),
  storeTargetShiftIdx: index('serah_terima_items_store_target_shift_idx')
    .on(table.storeId, table.targetShiftId),
}));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store Closing Task (evening / full_day, shared)
 *
 * Replaces these removed task tables:
 *   • edc_reconciliation_tasks
 *   • eod_z_report_tasks
 *   • open_statement_tasks
 *
 * Sections:
 *   1. EOD Z-Report photo evidence
 *   2. EDC Settlement checklist
 *   3. EDC Summary checklist
 *   4. Open Statement decision: post statement / on hold
 *
 * On Hold:
 *   • status stays "discrepancy"
 *   • isOnHold = true
 *   • holdIssueId links to the issue generated automatically
 *   • future store_closing_tasks still generate per day
 *   • when the issue is resolved, utils reopen this row as in_progress
 */
export const storeClosingTasks = pgTable('store_closing_tasks', {
  id:         serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => schedules.id).notNull(),
  userId:     text('user_id').references(() => users.id).notNull(),
  storeId:    integer('store_id').references(() => stores.id).notNull(),
  shiftId:    integer('shift_id').references(() => shifts.id).notNull(),
  date:       timestamp('date').notNull(),

  // 1. EOD Z-Report checklist
  eodZReportDone: boolean('eod_z_report_done').default(false).notNull(),
  eodZReportBy:   text('eod_z_report_by').references(() => users.id),
  eodZReportAt:   timestamp('eod_z_report_at'),

  // 2. Required evidence photo
  // Employee uploads one image showing EOD and EDC settlement side by side.
  eodEdcSettlementPhoto:   text('eod_edc_settlement_photo'),
  eodEdcSettlementPhotoBy: text('eod_edc_settlement_photo_by').references(() => users.id),
  eodEdcSettlementPhotoAt: timestamp('eod_edc_settlement_photo_at'),

  // 3. EDC Settlement
  edcSettlementDone:  boolean('edc_settlement_done').default(false).notNull(),
  edcSettlementNotes: text('edc_settlement_notes'),
  edcSettlementBy:    text('edc_settlement_by').references(() => users.id),
  edcSettlementAt:    timestamp('edc_settlement_at'),

  // 4. EDC Summary
  edcSummaryDone:  boolean('edc_summary_done').default(false).notNull(),
  edcSummaryNotes: text('edc_summary_notes'),
  edcSummaryBy:    text('edc_summary_by').references(() => users.id),
  edcSummaryAt:    timestamp('edc_summary_at'),

  // 5. Open Statement
  openStatementDecision:   text('open_statement_decision').$type<'post_statement' | 'on_hold' | null>(),
  openStatementHoldReason: text('open_statement_hold_reason'),
  openStatementBy:         text('open_statement_by').references(() => users.id),
  openStatementAt:         timestamp('open_statement_at'),

  // Hold / issue workflow
  isOnHold:    boolean('is_on_hold').default(false).notNull(),
  holdIssueId: integer('hold_issue_id').references(() => issues.id),
  heldBy:      text('held_by').references(() => users.id),
  heldAt:      timestamp('held_at'),

  holdResolvedAt: timestamp('hold_resolved_at'),
  reopenedAt:     timestamp('reopened_at'),

  completedBy:           text('completed_by').references(() => users.id),
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
  uniqueStoreDate: unique('store_closing_tasks_store_date_unique').on(t.storeId, t.date),
  storeDateIdx:    index('store_closing_tasks_store_date_idx').on(t.storeId, t.date),
  holdIssueIdx:    index('store_closing_tasks_hold_issue_idx').on(t.holdIssueId),
  statusIdx:       index('store_closing_tasks_status_idx').on(t.status),
}));

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

export type ItemReturnTask        = typeof itemReturnTasks.$inferSelect;
export type NewItemReturnTask     = typeof itemReturnTasks.$inferInsert;
export type ItemReturnEntry       = typeof itemReturnEntries.$inferSelect;
export type NewItemReturnEntry    = typeof itemReturnEntries.$inferInsert;

export type CekUangMukaTask       = typeof cekUangMukaTasks.$inferSelect;
export type NewCekUangMukaTask    = typeof cekUangMukaTasks.$inferInsert;
export type CekUangMukaDenomination    = typeof cekUangMukaDenominations.$inferSelect;
export type NewCekUangMukaDenomination = typeof cekUangMukaDenominations.$inferInsert;

export type BriefingTask          = typeof briefingTasks.$inferSelect;
export type NewBriefingTask       = typeof briefingTasks.$inferInsert;
export type SerahTerimaTask       = typeof serahTerimaTasks.$inferSelect;
export type NewSerahTerimaTask    = typeof serahTerimaTasks.$inferInsert;
export type SerahTerimaItem       = typeof serahTerimaItems.$inferSelect;
export type NewSerahTerimaItem    = typeof serahTerimaItems.$inferInsert;
export type StoreClosingTask      = typeof storeClosingTasks.$inferSelect;
export type NewStoreClosingTask   = typeof storeClosingTasks.$inferInsert;
export type GroomingTask          = typeof groomingTasks.$inferSelect;
export type NewGroomingTask       = typeof groomingTasks.$inferInsert;
export type MarketingCheckTask    = typeof marketingCheckTasks.$inferSelect;
export type NewMarketingCheckTask = typeof marketingCheckTasks.$inferInsert;
export type StoreFrontTask        = typeof storeFrontTasks.$inferSelect;
export type NewStoreFrontTask     = typeof storeFrontTasks.$inferInsert;
