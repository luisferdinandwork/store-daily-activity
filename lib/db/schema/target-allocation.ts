// lib/db/schema/target-allocation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Daily target allocation — NEW.
//
//   target_allocation_templates
//     The DEFAULT % split of a store's daily target across slots (PIC1,
//     PIC2, SA1..SAn), keyed by how many roster employees are actually
//     scheduled that day ("headcount", the "Man Power" row on the printed
//     grid Ops already uses). Admin-managed, mirrors the lookups.ts
//     conventions. If no row exists for a given headcount, the app falls
//     back to an equal split across everyone scheduled that day.
//
//   daily_target_overrides
//     Ops can override ONE employee's percentage for ONE specific
//     store + date. Every other employee scheduled that same day is
//     automatically rebalanced (proportional to the default template)
//     so the day's percentages still sum to 100%. Sparse — only the days
//     someone actually touched have rows here.
//
// See lib/performance/target-utils.ts (computeDailyAllocations,
// rebalanceDailyPercentages) for how these two tables are combined.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  integer,
  text,
  decimal,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

import { stores, users } from './core';

// ─── Default split template ──────────────────────────────────────────────────

export const targetAllocationTemplates = pgTable('target_allocation_templates', {
  id: serial('id').primaryKey(),

  /** How many roster employees are scheduled that day (the "Man Power" column). */
  headcount: integer('headcount').notNull(),

  /** PIC1 | PIC2 | SA1 | SA2 | SA3 | SA4 | SA5 | ... */
  slotCode: text('slot_code').notNull(),

  /** % of the store's daily target this slot receives at this headcount. */
  percentage: decimal('percentage', { precision: 5, scale: 2 }).notNull(),

  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqHeadcountSlot: unique('target_allocation_templates_headcount_slot_unique').on(
    t.headcount,
    t.slotCode,
  ),
  headcountIdx: index('target_allocation_templates_headcount_idx').on(t.headcount),
}));

// ─── Per-day, per-employee override ──────────────────────────────────────────

export const dailyTargetOverrides = pgTable('daily_target_overrides', {
  id: serial('id').primaryKey(),

  storeId: integer('store_id')
    .references(() => stores.id, { onDelete: 'cascade' })
    .notNull(),

  /** YYYY-MM-DD */
  date: text('date').notNull(),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),

  /**
   * Ops-set percentage for this employee on this day. This value is
   * "locked" — every other employee scheduled the same store + day is
   * rebalanced around it (see rebalanceDailyPercentages in target-utils.ts).
   */
  percentage: decimal('percentage', { precision: 5, scale: 2 }).notNull(),

  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
}, (t) => ({
  uniqStoreDateUser: unique('daily_target_overrides_store_date_user_unique').on(
    t.storeId,
    t.date,
    t.userId,
  ),
  storeDateIdx: index('daily_target_overrides_store_date_idx').on(t.storeId, t.date),
}));

// ─── Types ──────────────────────────────────────────────────────────────────

export type TargetAllocationTemplate = typeof targetAllocationTemplates.$inferSelect;
export type NewTargetAllocationTemplate = typeof targetAllocationTemplates.$inferInsert;
export type DailyTargetOverride = typeof dailyTargetOverrides.$inferSelect;
export type NewDailyTargetOverride = typeof dailyTargetOverrides.$inferInsert;