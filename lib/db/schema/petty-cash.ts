// lib/db/schema/petty-cash.ts

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  decimal,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

import { stores, users } from './core';

export const PETTY_CASH_MAX_BALANCE = 1_000_000;

// ─── Request categories ───────────────────────────────────────────────────────
//
// What a PIC picks when requesting petty cash (Galon, ATK, …), managed by IT
// at /it/petty-cash-categories. Picking one pre-fills the request's
// Keterangan with `defaultReason` (still editable); a `requiresCustomReason`
// category (Lain-Lain) has no default and the PIC must write their own.
// Requests keep a name snapshot, so renaming/deleting a category never
// rewrites history.
export const pettyCashCategories = pgTable('petty_cash_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  defaultReason: text('default_reason'),
  requiresCustomReason: boolean('requires_custom_reason').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

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

    // The amount the PIC originally asked for — an estimate. The amount
    // actually deducted from the balance is `actualAmount` below, once the
    // PIC records what was really spent.
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    // The request's reason (Keterangan) — pre-filled from the category's
    // default reason, or written by the PIC for Lain-Lain.
    description: text('description').notNull(),

    // Null on requests made before categories existed.
    categoryId: integer('category_id').references(() => pettyCashCategories.id, {
      onDelete: 'set null',
    }),
    categoryName: text('category_name'),

    userId: text('user_id').references(() => users.id).notNull(),
    storeId: integer('store_id').references(() => stores.id).notNull(),

    // New request status:
    // pending_ops   = employee requested, waiting OPS approval
    // ops_approved  = OPS approved the request itself; balance NOT deducted
    //                 yet — waiting on the PIC to record the actual amount
    //                 used (requested amounts are rarely exact)
    // completed     = PIC recorded the actual amount used; balance deducted
    //                 by that actual amount
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

    // The real amount spent, filled in by the PIC after OPS approves —
    // requests are rough estimates, so this is what actually gets cut from
    // the store's ready petty cash balance (see the PATCH handler in
    // app/api/employee/petty-cash/route.ts).
    actualAmount: decimal('actual_amount', { precision: 12, scale: 2 }),
    actualAmountBy: text('actual_amount_by').references(() => users.id),
    actualAmountAt: timestamp('actual_amount_at'),

    // Keep column if already exists, but do not use image deletion anymore.
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    periodIdx: index('pct_period_idx').on(t.periodId),
    storeMonthIdx: index('pct_store_month_idx').on(t.storeId, t.yearMonth),
    statusIdx: index('pct_status_idx').on(t.status),
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

// ─── Refill REQUESTS (PIC-initiated, distinct from Finance's own month-end
// close-and-reset `pettyCashRefills` above) ────────────────────────────────
//
// PIC asks for a mid-month top-up back to PETTY_CASH_MAX_BALANCE when the
// store runs low before month-end. OPS approves/rejects the request itself;
// approval alone does NOT move the balance — the store hasn't physically
// received the cash yet, and Finance (who still physically hands over the
// cash) hasn't necessarily done so at approval time either. PIC 1 (the
// petty cash holder) then uploads two proof
// photos: the petty cash drawer (cash counted inside it) and the Surat
// Terima Petty Cash. Only once BOTH photos are in does the CURRENT
// (still-open) period's balance actually top up; it does not close the
// period or roll to next month, unlike pettyCashRefills.
//
// "One request per store per month" is enforced in application code
// (lib/db/utils/petty-cash-refill.ts), not a DB constraint: a rejected
// request must free up the slot so PIC can fix and resubmit, which a plain
// unique(storeId, yearMonth) can't express without a partial index.

export const pettyCashRefillRequests = pgTable(
  'petty_cash_refill_requests',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),

    // YYYY-MM
    yearMonth: text('year_month').notNull(),

    requestedBy: text('requested_by').references(() => users.id).notNull(),
    requestedAt: timestamp('requested_at').defaultNow().notNull(),
    notes: text('notes'),

    // Where Finance sends the refill cash — PIC 1 fills these in at request
    // time (see lib/petty-cash-bank.ts). A snapshot per request: nullable only
    // because requests made before this existed have none.
    bankName: text('bank_name'),
    accountNumber: text('account_number'),
    accountHolderName: text('account_holder_name'),

    // pending | approved | rejected
    status: text('status').default('pending').notNull(),

    // Snapshot of petty_cash_periods.current_balance right before/after approval.
    balanceBefore: decimal('balance_before', { precision: 12, scale: 2 }),
    balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }),

    // OPS approval/rejection — this is what the employee sees as "Approved".
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),

    rejectedBy: text('rejected_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at'),
    rejectionReason: text('rejection_reason'),

    // Finance's "I have refilled this store" verification, done on the
    // Finance Petty Cash pages after OPS approval. PIC 1 can't upload the
    // proof-of-receipt photos below until this is set — the cash has to have
    // actually been sent first. Cleared again if Finance undoes it before any
    // photo is uploaded.
    financeVerifiedBy: text('finance_verified_by').references(() => users.id),
    financeVerifiedAt: timestamp('finance_verified_at'),

    // Proof-of-receipt photos, uploaded by PIC 1 once Finance has verified
    // the refill and handed over the cash.
    drawerPhotoUrl: text('drawer_photo_url'),
    signaturePhotoUrl: text('signature_photo_url'),
    proofUploadedBy: text('proof_uploaded_by').references(() => users.id),
    proofUploadedAt: timestamp('proof_uploaded_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    storeMonthIdx: index('pcrr_store_month_idx').on(t.storeId, t.yearMonth),
    statusIdx: index('pcrr_status_idx').on(t.status),
  }),
);

export type PettyCashCategory = typeof pettyCashCategories.$inferSelect;
export type NewPettyCashCategory = typeof pettyCashCategories.$inferInsert;

export type PettyCashPeriod = typeof pettyCashPeriods.$inferSelect;
export type NewPettyCashPeriod = typeof pettyCashPeriods.$inferInsert;

export type PettyCashTransaction = typeof pettyCashTransactions.$inferSelect;
export type NewPettyCashTransaction = typeof pettyCashTransactions.$inferInsert;

export type PettyCashRefill = typeof pettyCashRefills.$inferSelect;
export type NewPettyCashRefill = typeof pettyCashRefills.$inferInsert;

export type PettyCashRefillRequest = typeof pettyCashRefillRequests.$inferSelect;
export type NewPettyCashRefillRequest = typeof pettyCashRefillRequests.$inferInsert;