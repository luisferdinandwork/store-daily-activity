// lib/db/schema/impact-visits.ts
//
// OPS store-visit audit — digitizes the paper "OPS IMPACT VISIT AND
// CHECKLIST" form, filled by an Ops user while visiting a store.
//
// One row = one visit, bundling three sections filled together on paper:
//   1. Main checklist (sections A-G, 100 pts) — checklistResponses/Score/Grade
//   2. Cash money denomination count          — cashMoneyData
//   3. VM checklist (sections A-E, 70 pts)    — vmChecklistResponses/Score/Grade
//
// Checklist item definitions (labels, points, hints) live in
// lib/impact-visit/checklist-config.ts as static data, not DB rows — only
// the per-visit ANSWERS are stored here, as JSON keyed by item id:
//   { [itemId]: { answer: 'ya' | 'tidak', note?: string } }
//
// Scoring is binary per item (see lib/impact-visit/scoring.ts): the paper
// form's own rule is "if any single point being checked isn't done, the
// item scores 0" — so 'ya' = full points, 'tidak' = 0, no partial credit.
//
// Visibility/permissions mirror the Issues feature's area scoping
// (lib/db/utils/issues.ts, app/api/ops/issues/route.ts): ops_area fills and
// sees only their own area's visits (via store.areaId); ops_ho/admin can
// fill a visit for any store and sees every area's visits.

import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  decimal,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { stores, users } from './core';

export const impactVisitStatusEnum = pgEnum('impact_visit_status', ['draft', 'submitted']);

export const impactVisits = pgTable('impact_visits', {
  id: serial('id').primaryKey(),

  storeId:   integer('store_id').references(() => stores.id).notNull(),
  visitedBy: text('visited_by').references(() => users.id).notNull(),
  visitDate: timestamp('visit_date').notNull(),

  // Header fields from the paper form.
  targetBulanBerjalan: text('target_bulan_berjalan'),
  periodeTanggal:      text('periode_tanggal'),
  pencapaianPct:       decimal('pencapaian_pct', { precision: 5, scale: 2 }),

  // 1. Main checklist (sections A-G, 100 pts).
  checklistResponses: text('checklist_responses'),
  checklistScore:     integer('checklist_score').default(0).notNull(),
  checklistMaxScore:  integer('checklist_max_score').default(100).notNull(),
  checklistGrade:     text('checklist_grade'), // 'A' | 'B'

  // 2. Cash money denomination count.
  cashMoneyData: text('cash_money_data'),

  // 3. VM checklist (sections A-E, 70 pts).
  vmChecklistResponses: text('vm_checklist_responses'),
  vmChecklistScore:     integer('vm_checklist_score').default(0).notNull(),
  vmChecklistMaxScore:  integer('vm_checklist_max_score').default(70).notNull(),
  vmChecklistGrade:     text('vm_checklist_grade'), // 'A' | 'B'

  // Simplified stand-in for the paper form's multi-person sign-off lines
  // (Ops Area / PIC 1 / PIC 2 / VM Staff) — visitedBy already identifies who
  // conducted the visit, this just carries any free-text acknowledgement.
  notes: text('notes'),

  status: impactVisitStatusEnum('status').default('draft').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  storeIdx:     index('impact_visits_store_idx').on(t.storeId),
  visitedByIdx: index('impact_visits_visited_by_idx').on(t.visitedBy),
  statusIdx:    index('impact_visits_status_idx').on(t.status),
}));

export type ImpactVisit = typeof impactVisits.$inferSelect;
export type NewImpactVisit = typeof impactVisits.$inferInsert;
