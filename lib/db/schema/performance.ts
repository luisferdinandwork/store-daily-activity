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
// Important design rule:
// Store target numbers are NOT manually stored here anymore.
//
// The store monthly target is automatically calculated from the sum of active
// employee_monthly_targets rows for the same store + month.
//
// This table is only the monthly "header/plan" used by Ops later for:
//   - opening/locking a target month for a store
//   - notes/status/audit
//   - grouping employee targets under one store-month plan
//
// Store monthly sales target = SUM(employee_monthly_targets.monthlySalesTarget)
// Store monthly transaction target = SUM(employee_monthly_targets.monthlyTransactionTarget)
// Store monthly ATV target = sales target / transaction target

export const storeMonthlyTargets = pgTable('store_monthly_targets', {
  id: serial('id').primaryKey(),

  storeId: integer('store_id')
    .references(() => stores.id, { onDelete: 'cascade' })
    .notNull(),

  /** YYYY-MM, e.g. 2026-06 */
  yearMonth: text('year_month').notNull(),

  /** Always employee_rollup for the new model. Kept as text for future modes if needed. */
  targetSource: text('target_source').default('employee_rollup').notNull(),

  /** Optional workflow fields for the future Ops management page. */
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

// ─── Employee Monthly Target ────────────────────────────────────────────────
//
// Source of truth for performance targets.
//
// One row per employee + store + month.
// This is what makes targets different for each employee in each store.
// Example:
//   PIC1 / PIC2: targetRoleCode = PIC1/PIC2, targetWeightPct = 10.00
//   SA:          targetRoleCode = SA,        targetWeightPct = 100.00
//
// Store target is automatically calculated by summing these employee rows.
// Daily target is NOT stored here. It is calculated dynamically:
//   employee monthly target / count of days employee is scheduled in that store.

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

  /**
   * For Ops display/filtering later.
   * Examples: PIC1, PIC2, SA, CASHIER, SPV.
   */
  targetRoleCode: text('target_role_code').default('SA').notNull(),

  /**
   * Optional allocation weight used by seeders / Ops helpers.
   * Example: PIC1/PIC2 can be 10.00 while SA is 100.00.
   * The actual target is still monthlySalesTarget/monthlyTransactionTarget.
   */
  targetWeightPct: decimal('target_weight_pct', {
    precision: 7,
    scale: 2,
  }).default('100.00').notNull(),

  monthlySalesTarget: decimal('monthly_sales_target', {
    precision: 14,
    scale: 2,
  })
    .default('0')
    .notNull(),

  monthlyTransactionTarget: integer('monthly_transaction_target')
    .default(0)
    .notNull(),

  monthlyAtvTarget: decimal('monthly_atv_target', {
    precision: 12,
    scale: 2,
  }).default('0'),

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
