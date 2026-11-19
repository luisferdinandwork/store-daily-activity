// lib/db/schema/bin-rounds.ts
//
// Cek Bin · monthly bin round (rules + shapes: lib/bin-round.ts; logic: lib/db/utils/bin-round.ts).
//
//   store_bin_codes        every bin Business Central lists for a store (ppBinContentsAPI), refreshed about once a
//                          day; a bin BC no longer lists stays with is_active = false.
//   store_bin_syncs        when that list was last read from BC (one row per store; also the "someone is reading it
//                          now" claim, so two servers never read the same store at once).
//   bin_check_months       one row per store per month = the SAVED monthly stats (total / checked / right / wrong /
//                          fixed). A new month starts a new row with every bin pending again.
//   bin_check_month_bins   one row per bin per store per month: its result this month (first check = the result,
//                          last check = whether it was fixed) and how often it was handed out.
//   bin_check_assignments  the day's list: the 20 bins a store was asked to scan on a Jakarta day.
//
// Days are plain `date` columns (YYYY-MM-DD strings) — no timezone encoding to worry about.

import { boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { stores } from './core';
import type { BinResult, BinRoundStatus, BinWrongLine } from '@/lib/bin-round';

export const storeBinCodes = pgTable(
  'store_bin_codes',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    binCode: text('bin_code').notNull(),
    /** Item lines BC has in the bin (incl. zero quantity). */
    itemLines: integer('item_lines').default(0).notNull(),
    /** Σ quantityBase, rounded. */
    quantity: integer('quantity').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    firstSeenAt: timestamp('first_seen_at', { mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).notNull(),
  },
  (t) => ({
    storeBinUnique: unique('store_bin_codes_store_bin_unique').on(t.storeId, t.binCode),
    storeIdx: index('store_bin_codes_store_idx').on(t.storeId),
  }),
);

export const storeBinSyncs = pgTable('store_bin_syncs', {
  storeId: integer('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  /** Last successful read. */
  syncedAt: timestamp('synced_at', { mode: 'date' }),
  binCount: integer('bin_count'),
  /** Last start of a read (claim). */
  attemptedAt: timestamp('attempted_at', { mode: 'date' }),
  /** Why the last read failed; cleared by the next start. */
  error: text('error'),
});

export const binCheckMonths = pgTable(
  'bin_check_months',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    /** YYYY-MM */
    yearMonth: text('year_month').notNull(),

    totalBins: integer('total_bins').default(0).notNull(),
    checkedBins: integer('checked_bins').default(0).notNull(),
    correctBins: integer('correct_bins').default(0).notNull(),
    wrongBins: integer('wrong_bins').default(0).notNull(),
    fixedBins: integer('fixed_bins').default(0).notNull(),

    /** When the store's bin list was last copied into the month. */
    binsFilledAt: timestamp('bins_filled_at', { mode: 'date' }),
    /** When BC's scan results were last read into the month. */
    resultsSyncedAt: timestamp('results_synced_at', { mode: 'date' }),
    /** Set once the month is over and read one last time — its stats no longer change. */
    finalizedAt: timestamp('finalized_at', { mode: 'date' }),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (t) => ({
    storeMonthUnique: unique('bin_check_months_store_month_unique').on(t.storeId, t.yearMonth),
    monthIdx: index('bin_check_months_month_idx').on(t.yearMonth),
  }),
);

export const binCheckMonthBins = pgTable(
  'bin_check_month_bins',
  {
    id: serial('id').primaryKey(),
    monthId: integer('month_id')
      .references(() => binCheckMonths.id, { onDelete: 'cascade' })
      .notNull(),
    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    yearMonth: text('year_month').notNull(),
    binCode: text('bin_code').notNull(),

    /** Still on BC's list for the store (a pending bin BC dropped is left out of the month). */
    inBc: boolean('in_bc').default(true).notNull(),
    status: text('status').$type<BinRoundStatus>().default('pending').notNull(),

    firstCheckedOn: date('first_checked_on', { mode: 'string' }),
    firstWrongCount: integer('first_wrong_count').default(0).notNull(),
    /** Snapshot of the first check's wrong item lines (capped, MAX_WRONG_LINES). */
    wrongLines: jsonb('wrong_lines').$type<BinWrongLine[]>().default([]).notNull(),
    lastCheckedOn: date('last_checked_on', { mode: 'string' }),
    lastResult: text('last_result').$type<BinResult>(),
    checkDays: integer('check_days').default(0).notNull(),

    timesAssigned: integer('times_assigned').default(0).notNull(),
    firstAssignedOn: date('first_assigned_on', { mode: 'string' }),
    lastAssignedOn: date('last_assigned_on', { mode: 'string' }),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (t) => ({
    storeMonthBinUnique: unique('bin_check_month_bins_store_month_bin_unique').on(t.storeId, t.yearMonth, t.binCode),
    monthIdx: index('bin_check_month_bins_month_idx').on(t.monthId),
  }),
);

export const binCheckAssignments = pgTable(
  'bin_check_assignments',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    checkDate: date('check_date', { mode: 'string' }).notNull(),
    yearMonth: text('year_month').notNull(),
    binCode: text('bin_code').notNull(),
    /** 1…20, the walking order. */
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (t) => ({
    storeDayBinUnique: unique('bin_check_assignments_store_day_bin_unique').on(t.storeId, t.checkDate, t.binCode),
    storeDayIdx: index('bin_check_assignments_store_day_idx').on(t.storeId, t.checkDate),
  }),
);

export type StoreBinCode = typeof storeBinCodes.$inferSelect;
export type BinCheckMonth = typeof binCheckMonths.$inferSelect;
export type BinCheckMonthBin = typeof binCheckMonthBins.$inferSelect;
export type BinCheckAssignment = typeof binCheckAssignments.$inferSelect;
