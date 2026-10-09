// lib/db/schema/sales-returns.ts
//
// Sales Return — an employee files the POS receipt of a customer return from
// the staff app: the receipt number typed in + 1–3 photos of the receipt(s).
// Who and when are never typed: `userId` is the session user and `createdAt`
// is the moment of upload. Ops (own area) and Finance (all stores) browse them.
//
// `storeId` is the filer's home store at the time — kept on the row so a later
// transfer of the employee doesn't move old returns to another store.

import { pgTable, serial, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

import { stores, users } from './core';

export const salesReturns = pgTable(
  'sales_returns',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id)
      .notNull(),
    userId: text('user_id')
      .references(() => users.id)
      .notNull(),

    // The POS slip number, normalised on write (trimmed, no spaces, upper-case).
    receiptNumber: text('receipt_number').notNull(),

    // JSON array of public storage URLs (the codebase's photo-column convention).
    imageUrls: text('image_urls').notNull(),

    // Set explicitly on insert (`new Date()`): the DB session runs in Asia/Jakarta,
    // so a defaultNow() value would read back 7h off through Drizzle.
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    storeCreatedIdx: index('sales_returns_store_created_idx').on(t.storeId, t.createdAt),
    createdIdx: index('sales_returns_created_idx').on(t.createdAt),
    receiptIdx: index('sales_returns_receipt_idx').on(t.receiptNumber),
  }),
);

export type SalesReturn = typeof salesReturns.$inferSelect;
export type NewSalesReturn = typeof salesReturns.$inferInsert;
