// lib/db/schema/petty-cash.ts

import {
  pgTable,
  serial,
  text,
  integer,
  decimal,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

import { stores, users } from './core';

export const PETTY_CASH_MAX_BALANCE = 1_000_000;

export const pettyCashPeriods = pgTable(
  'petty_cash_periods',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),

    // YYYY-MM
    yearMonth: text('year_month').notNull(),

    // Usually 1,000,000
    openingBalance: decimal('opening_balance', {
      precision: 12,
      scale: 2,
    })
      .default('1000000')
      .notNull(),

    // Live remaining balance for this month
    currentBalance: decimal('current_balance', {
      precision: 12,
      scale: 2,
    })
      .default('1000000')
      .notNull(),

    // Final remaining balance after Finance closes/refills the month
    closingBalance: decimal('closing_balance', {
      precision: 12,
      scale: 2,
    }),

    // open | closed
    status: text('status').default('open').notNull(),

    closedBy: text('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    uniqStoreMonth: unique('pcp_store_month_unique').on(t.storeId, t.yearMonth),
    storeMonthIdx: index('pcp_store_month_idx').on(t.storeId, t.yearMonth),
    statusIdx: index('pcp_status_idx').on(t.status),
  }),
);

// lib/db/schema/petty-cash.ts

export const pettyCashTransactions = pgTable(
  'petty_cash_transactions',
  {
    id: serial('id').primaryKey(),

    periodId: integer('period_id').references(() => pettyCashPeriods.id, {
      onDelete: 'set null',
    }),

    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    description: text('description').notNull(),

    userId: text('user_id').references(() => users.id).notNull(),
    storeId: integer('store_id').references(() => stores.id).notNull(),

    // New request status:
    // pending_ops   = employee requested, waiting OPS approval
    // ops_approved  = OPS approved, balance deducted
    // ops_rejected  = OPS rejected, no balance deduction
    status: text('status').default('pending_ops').notNull(),

    imageUrl: text('image_url'),
    imageKey: text('image_key'),

    yearMonth: text('year_month').notNull(),

    // Use this as OPS approval now.
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),

    rejectedBy: text('rejected_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at'),
    rejectionReason: text('rejection_reason'),

    // Finance verification after receipt image exists.
    verifiedBy: text('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at'),

    // Keep column if already exists, but do not use image deletion anymore.
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    periodIdx: index('pct_period_idx').on(t.periodId),
    storeMonthIdx: index('pct_store_month_idx').on(t.storeId, t.yearMonth),
    statusIdx: index('pct_status_idx').on(t.status),
    verifiedIdx: index('pct_verified_idx').on(t.verifiedAt),
    yearMonthIdx: index('pct_year_month_idx').on(t.yearMonth),
  }),
);

export const pettyCashRefills = pgTable(
  'petty_cash_refills',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),

    // The month being closed/refilled.
    // Example: Finance closes 2026-06 and creates 2026-07.
    yearMonth: text('year_month').notNull(),

    // The new month created by the refill.
    nextYearMonth: text('next_year_month').notNull(),

    refillAmount: decimal('refill_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),

    // Remaining balance of the closed month
    balanceBefore: decimal('balance_before', {
      precision: 12,
      scale: 2,
    }).notNull(),

    // New month starting balance, usually 1,000,000
    balanceAfter: decimal('balance_after', {
      precision: 12,
      scale: 2,
    }).notNull(),

    refillBy: text('refill_by').references(() => users.id).notNull(),

    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqStoreMonth: unique('pcr_store_month_unique').on(t.storeId, t.yearMonth),
    storeMonthIdx: index('pcr_store_month_idx').on(t.storeId, t.yearMonth),
    nextMonthIdx: index('pcr_next_month_idx').on(t.nextYearMonth),
  }),
);

export type PettyCashPeriod = typeof pettyCashPeriods.$inferSelect;
export type NewPettyCashPeriod = typeof pettyCashPeriods.$inferInsert;

export type PettyCashTransaction = typeof pettyCashTransactions.$inferSelect;
export type NewPettyCashTransaction = typeof pettyCashTransactions.$inferInsert;

export type PettyCashRefill = typeof pettyCashRefills.$inferSelect;
export type NewPettyCashRefill = typeof pettyCashRefills.$inferInsert;