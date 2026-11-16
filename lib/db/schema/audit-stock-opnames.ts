// lib/db/schema/audit-stock-opnames.ts
//
// Audit "Stock Opname" — the audit team's stock count at a store, printed as the Berita Acara Stock Opname (the "BA"
// sheet of format stock opname audit.xlsx), the Surat Pernyataan Hasil SO Store and the Super Reward (the "Super
// Reward" sheet; rules + shapes: lib/audit-stock-opname.ts, lib/audit-super-reward.ts; logic:
// lib/db/utils/audit-stock-opname.ts, lib/db/utils/audit-super-reward.ts).
//
// ONE row per store per Jakarta day (`so_date`, a plain `date`). The numbers start from Business Central (the day's
// Cek Bin lines, the bin contents, POS sales) and are saved as the auditor confirmed them — a SNAPSHOT, so a printed
// BA never changes when BC does. `bc_snapshot` keeps what BC said at the time, as a reference.
//
// The document number is shared with the Berita Acara Pemeriksaan Kas of the same store + day (one visit = one number,
// like the BA and CO sheets of the same workbook); the running number is counted over both tables.

import { date, index, integer, jsonb, pgTable, serial, text, timestamp, unique, bigint } from 'drizzle-orm/pg-core';

import { stores, users } from './core';
import type { SoBcSnapshot } from '@/lib/audit-stock-opname';
import type { SoRewardRow } from '@/lib/audit-super-reward';

export const auditStockOpnames = pgTable(
  'audit_stock_opnames',
  {
    id: serial('id').primaryKey(),

    storeId: integer('store_id')
      .references(() => stores.id, { onDelete: 'cascade' })
      .notNull(),
    soDate: date('so_date', { mode: 'string' }).notNull(),

    // ── Kop (printed) ──
    docSeq: integer('doc_seq').notNull(),
    docNumber: text('doc_number').notNull(),
    signCity: text('sign_city').notNull(),
    signDate: date('sign_date', { mode: 'string' }).notNull(),
    // BA title line 2, e.g. "FISIK SPORT PLAZA MEDAN FAIR".
    storeTitle: text('store_title').notNull(),

    // ── Hasil perhitungan (pcs) ──
    sohBc: integer('soh_bc').notNull().default(0),
    scanQty: integer('scan_qty').notNull().default(0),
    shoppingBagQty: integer('shopping_bag_qty').notNull().default(0),
    transSalesQty: integer('trans_sales_qty').notNull().default(0),

    // ── Nilai selisih (Rp, magnitudes; NULL = not filled → "-") ──
    valuePlus: bigint('value_plus', { mode: 'number' }),
    valueMinus: bigint('value_minus', { mode: 'number' }),
    // 'bc' = priced from BC lines, 'manual' = typed by the auditor.
    valueSource: text('value_source'),

    // ── Data stock opname bin (Surat) ──
    binsTotal: integer('bins_total').notNull().default(0),
    binsMatch: integer('bins_match').notNull().default(0),
    binsMismatch: integer('bins_mismatch').notNull().default(0),

    // Temuan stock opname — one line each.
    findings: jsonb('findings').$type<string[]>().notNull().default([]),
    bcSnapshot: jsonb('bc_snapshot').$type<SoBcSnapshot>(),
    notes: text('notes'),

    // ── Surat Pernyataan ──
    suratCity: text('surat_city').notNull().default(''),
    // FF / FS / OD / FO / SS — which brand line carries the location ('' = none).
    suratBrand: text('surat_brand').notNull().default(''),
    suratLocation: text('surat_location').notNull().default(''),

    // ── Tanda tangan ──
    // Head Store (normally PIC 1). The name is a snapshot; the id only pre-selects the picker.
    holderUserId: text('holder_user_id').references(() => users.id, { onDelete: 'set null' }),
    holderName: text('holder_name').notNull().default(''),
    holderCaption: text('holder_caption').notNull().default(''),
    holderTitle: text('holder_title').notNull().default('Head Store'),
    auditorUserId: text('auditor_user_id').references(() => users.id, { onDelete: 'set null' }),
    auditorName: text('auditor_name').notNull().default(''),
    auditorCaption: text('auditor_caption').notNull().default('Tim Audit'),
    knownName: text('known_name').notNull().default(''),
    knownTitle: text('known_title').notNull().default(''),
    approvedName: text('approved_name').notNull().default(''),
    approvedTitle: text('approved_title').notNull().default(''),
    // Dept IR — signs the Super Reward only ('' = DEFAULT_IR when read).
    irName: text('ir_name').notNull().default(''),
    irTitle: text('ir_title').notNull().default(''),

    // ── Super Reward (Lampiran Regular Reward, lib/audit-super-reward.ts) ──
    // One row per employee, a snapshot. NULL = not filled yet (the editor starts from the store's staff).
    rewardRows: jsonb('reward_rows').$type<SoRewardRow[]>(),
    rewardCheckedAt: timestamp('reward_checked_at'),
    rewardCheckedBy: text('reward_checked_by').references(() => users.id, { onDelete: 'set null' }),

    checkedAt: timestamp('checked_at'),
    checkedBy: text('checked_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Set explicitly on write (`new Date()`): the DB session runs in Asia/Jakarta, so defaultNow() reads back 7h off.
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    storeDayUnique: unique('audit_stock_opnames_store_day_unique').on(t.storeId, t.soDate),
    dateIdx: index('audit_stock_opnames_date_idx').on(t.soDate),
  }),
);

export type AuditStockOpname = typeof auditStockOpnames.$inferSelect;
export type NewAuditStockOpname = typeof auditStockOpnames.$inferInsert;
