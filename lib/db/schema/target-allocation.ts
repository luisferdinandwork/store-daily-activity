// lib/db/schema/target-allocation.ts
// ─────────────────────────────────────────────────────────────────────────────
// target_allocation_templates
//   The DEFAULT % split of a store's monthly target across slots (PIC1,
//   PIC2, SA1..SAn), keyed by the store's total roster headcount for the
//   month ("Man Power", the printed grid Ops already uses). IT-managed
//   (see app/it/target-allocation), mirrors the lookups.ts conventions.
//   If no row exists for a given headcount, the app falls back to an
//   equal split across the roster.
//
//   employee_monthly_targets.percentage (performance.ts) is seeded from
//   this table via assignMonthlySlots()/syncRosterPercentages() in
//   target-utils.ts whenever the roster changes, and stays fixed for the
//   whole month unless Ops overrides it per employee.
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

// ─── Default split template ──────────────────────────────────────────────────

export const targetAllocationTemplates = pgTable('target_allocation_templates', {
  id: serial('id').primaryKey(),

  /** The store's total target-roster headcount for the month (the "Man Power" column). */
  headcount: integer('headcount').notNull(),

  /** PIC1 | PIC2 | SA1 | SA2 | SA3 | SA4 | SA5 | ... */
  slotCode: text('slot_code').notNull(),

  /** % of the store's monthly target this slot receives at this headcount. */
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

// ─── Types ──────────────────────────────────────────────────────────────────

export type TargetAllocationTemplate = typeof targetAllocationTemplates.$inferSelect;
export type NewTargetAllocationTemplate = typeof targetAllocationTemplates.$inferInsert;