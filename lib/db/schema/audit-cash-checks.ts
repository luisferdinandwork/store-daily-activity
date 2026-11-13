// lib/db/schema/audit-cash-checks.ts
//
// Audit "Pemeriksaan Kas" — the surprise cash count the audit team does at a store, printed as the Berita Acara
// Pemeriksaan Kas (rules + shapes: lib/audit-cash-check.ts; logic: lib/db/utils/audit-cash-check.ts).
//
// ONE row per store per Jakarta day. Two Audit pages fill it: Cek Modal (the cashier float + sales in the drawer +
// the counted float) and Cek Petty Cash (the ticked requests Finance has not covered yet + the counted petty cash).
// Each half has its own "checked at / by", so the Berita Acara knows which half is done.
//
// Money is whole Rupiah in `integer` columns. Counts are `{ [denominationId]: pieces }` (AUDIT_DENOMINATIONS).
// `petty_items` is a SNAPSHOT of the checklist as the auditor saved it (amounts, Keterangan, ticks), so the printed
// Berita Acara never changes when Finance later reviews or refills those requests.
//
// `check_date` is a plain `date` (YYYY-MM-DD as a string) — no timezone encoding to worry about.

import { date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { stores, users } from './core';
import type { DenominationCounts, PettyCheckItem, PettyExtraItem } from '@/lib/audit-cash-check';

export const auditCashChecks = pgTable(
  'audit_cash_checks',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    checkDate: date('check_date', { mode: 'string' }).notNull(),

    // ── Header (printed) ──
    // Running number of the year, assigned on the first save; `doc_number` is the printed text and can be edited.
    docSeq: integer('doc_seq').notNull(),
    docNumber: text('doc_number').notNull(),
    signCity: text('sign_city').notNull(),
    signDate: date('sign_date', { mode: 'string' }).notNull(),

    // The Pemegang Kas (normally the store's PIC 1). The name is a snapshot; the id only pre-selects the picker.
    holderUserId: text('holder_user_id').references(() => users.id, { onDelete: 'set null' }),
    holderName: text('holder_name').notNull().default(''),
    holderCaption: text('holder_caption').notNull().default(''),

    auditorUserId: text('auditor_user_id').references(() => users.id, { onDelete: 'set null' }),
    auditorName: text('auditor_name').notNull().default(''),
    auditorCaption: text('auditor_caption').notNull().default('Tim Audit'),

    knownName: text('known_name').notNull().default(''),
    knownTitle: text('known_title').notNull().default(''),
    approvedName: text('approved_name').notNull().default(''),
    approvedTitle: text('approved_title').notNull().default(''),

    // ── Cek Modal ──
    modalBook: integer('modal_book').notNull().default(0),
    salesCash: integer('sales_cash').notNull().default(0),
    salesDebit: integer('sales_debit').notNull().default(0),
    salesCredit: integer('sales_credit').notNull().default(0),
    salesVoucher: integer('sales_voucher').notNull().default(0),
    modalCounts: jsonb('modal_counts').$type<DenominationCounts>().notNull().default({}),
    modalNotes: text('modal_notes'),
    modalCheckedAt: timestamp('modal_checked_at'),
    modalCheckedBy: text('modal_checked_by').references(() => users.id, { onDelete: 'set null' }),

    // ── Cek Petty Cash ──
    pettyFund: integer('petty_fund').notNull().default(1_000_000),
    pettyItems: jsonb('petty_items').$type<PettyCheckItem[]>().notNull().default([]),
    pettyExtras: jsonb('petty_extras').$type<PettyExtraItem[]>().notNull().default([]),
    // "Penggantian petty cash periode lalu yang belum diterima" — pre-filled from the system, editable.
    pettyPendingRefill: integer('petty_pending_refill').notNull().default(0),
    pettyCounts: jsonb('petty_counts').$type<DenominationCounts>().notNull().default({}),
    pettyNotes: text('petty_notes'),
    // What PRISM said the box should hold when the petty cash half was saved (reference only).
    pettySystemBalance: integer('petty_system_balance'),
    pettyCheckedAt: timestamp('petty_checked_at'),
    pettyCheckedBy: text('petty_checked_by').references(() => users.id, { onDelete: 'set null' }),

    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Set explicitly on write (`new Date()`): the DB session runs in Asia/Jakarta, so defaultNow() reads back 7h off.
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    storeDayUnique: unique('audit_cash_checks_store_day_unique').on(t.storeId, t.checkDate),
    dateIdx: index('audit_cash_checks_date_idx').on(t.checkDate),
  }),
);

export type AuditCashCheck = typeof auditCashChecks.$inferSelect;
export type NewAuditCashCheck = typeof auditCashChecks.$inferInsert;
