// lib/db/schema/performance.ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  decimal,
  integer,
  unique,
  serial,
  index,
} from 'drizzle-orm/pg-core';

import { stores, users } from './core';

// ─── Store Monthly Target Plan ───────────────────────────────────────────────
//
// CHANGED (see target-allocation.ts for the new daily-split pieces):
//
// Store target numbers are now set DIRECTLY by Ops on this table. The old
// "employee rollup" model (store total = SUM of employee_monthly_targets) is
// retired — employee_monthly_targets no longer stores amounts at all.
//
// Daily store target = monthlySalesTarget / days-in-month. That daily
// figure is then split across whichever roster employees are actually
// scheduled to work each day, using target_allocation_templates (default
// split, keyed by headcount) with optional per-day, per-employee overrides
// in daily_target_overrides.
//
// See lib/performance/target-utils.ts for all the derivation logic.

export const storeMonthlyTargets = pgTable('store_monthly_targets', {
  id: serial('id').primaryKey(),

  storeId: integer('store_id')
    .references(() => stores.id, { onDelete: 'cascade' })
    .notNull(),

  /** YYYY-MM, e.g. 2026-06 */
  yearMonth: text('year_month').notNull(),

  /** The store's whole monthly target — set directly by Ops now. */
  monthlySalesTarget: decimal('monthly_sales_target', {
    precision: 14,
    scale: 2,
  }).default('0').notNull(),

  monthlyTransactionTarget: integer('monthly_transaction_target')
    .default(0)
    .notNull(),

  /** 'manual' is the only mode now; kept as text in case other modes return later. */
  targetSource: text('target_source').default('manual').notNull(),

  isLocked: boolean('is_locked').default(false).notNull(),
  lockedAt: timestamp('locked_at'),
  lockedBy: text('locked_by').references(() => users.id),

  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),

  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqStoreMonth: unique('store_monthly_targets_store_month_unique').on(
    t.storeId,
    t.yearMonth,
  ),
  storeMonthIdx: index('store_monthly_targets_store_month_idx').on(
    t.storeId,
    t.yearMonth,
  ),
  activeIdx: index('store_monthly_targets_active_idx').on(t.isActive),
}));

// ─── Employee Monthly Roster ─────────────────────────────────────────────────
//
// CHANGED: this table used to be the source of truth for each employee's
// nominal sales/transaction targets (monthlySalesTarget, targetWeightPct,
// etc). It no longer stores any amount — it only says "this employee is on
// this store's target roster for this month, in this slot."
//
//   targetRoleCode — fixed identity: 'PIC1' | 'PIC2' | 'SA'
//   sortOrder      — tie-breaker used to rank SA employees into SA1, SA2, ...
//                    on days when several SAs are scheduled together (lower
//                    sortOrder = ranked first). Ignored for PIC1 / PIC2,
//                    which always keep their own column.
//
// Nominal daily/monthly amounts are always computed on the fly from the
// store's daily target × that day's allocation percentage — see
// computeDailyAllocations() / computeEmployeeMonthlyTargetFromDailyAllocations()
// in target-utils.ts. Nothing here is edited directly to "give someone more
// money" — that happens per-day, per-employee, in daily_target_overrides.

export const employeeMonthlyTargets = pgTable('employee_monthly_targets', {
  id: serial('id').primaryKey(),

  storeMonthlyTargetId: integer('store_monthly_target_id')
    .references(() => storeMonthlyTargets.id, { onDelete: 'cascade' }),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),

  storeId: integer('store_id')
    .references(() => stores.id, { onDelete: 'cascade' })
    .notNull(),

  /** YYYY-MM, e.g. 2026-06 */
  yearMonth: text('year_month').notNull(),

  /** PIC1 | PIC2 | SA — matches the LEVEL rows in target_allocation_templates. */
  targetRoleCode: text('target_role_code').default('SA').notNull(),

  /** Ranks SA employees into SA1 / SA2 / ... when several work the same day. */
  sortOrder: integer('sort_order').default(0).notNull(),

  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),

  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqEmployeeStoreMonth: unique('employee_monthly_targets_user_store_month_unique').on(
    t.userId,
    t.storeId,
    t.yearMonth,
  ),
  userStoreMonthIdx: index('employee_monthly_targets_user_store_month_idx').on(
    t.userId,
    t.storeId,
    t.yearMonth,
  ),
  storeMonthIdx: index('employee_monthly_targets_store_month_idx').on(
    t.storeId,
    t.yearMonth,
  ),
  planIdx: index('employee_monthly_targets_plan_idx').on(t.storeMonthlyTargetId),
  roleIdx: index('employee_monthly_targets_role_idx').on(t.targetRoleCode),
  activeIdx: index('employee_monthly_targets_active_idx').on(t.isActive),
}));

// ─── Types ──────────────────────────────────────────────────────────────────

export type StoreMonthlyTarget = typeof storeMonthlyTargets.$inferSelect;
export type NewStoreMonthlyTarget = typeof storeMonthlyTargets.$inferInsert;
export type EmployeeMonthlyTarget = typeof employeeMonthlyTargets.$inferSelect;
export type NewEmployeeMonthlyTarget = typeof employeeMonthlyTargets.$inferInsert;