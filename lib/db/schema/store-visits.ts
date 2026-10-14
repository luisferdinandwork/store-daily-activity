import { pgTable, text, integer, jsonb, timestamp, decimal, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stores, users } from './core';
import type { VisitAnswer, VisitTask, VisitCategory, VisitPhotoGeo } from '@/lib/store-visit/types';

// Store codes keep the Excel roster intact even before a store exists in PRISM.
export const storeVisitPolicies = pgTable('store_visit_policies', {
  storeNo: text('store_no').primaryKey(),
  storeName: text('store_name').notNull(),
  manager: text('manager').notNull(),
  city: text('city').notNull(),
  category: text('category').$type<VisitCategory>().notNull(),
  intervalDays: integer('interval_days').notNull(),
  minimumVisits: integer('minimum_visits').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('store_visit_policy_category', sql`${t.category} IN ('in_city', 'out_city')`),
  check('store_visit_policy_interval', sql`${t.intervalDays} BETWEEN 1 AND 365 AND ${t.minimumVisits} BETWEEN 1 AND ${t.intervalDays}`),
]);

export const storeVisitConfig = pgTable('store_visit_config', {
  id: integer('id').primaryKey(),
  tasks: jsonb('tasks').$type<VisitTask[]>().notNull(),
  version: integer('version').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check('store_visit_config_singleton', sql`${t.id} = 1`)]);

// Submitted visits are immutable. Checklist snapshots preserve old reports
// after IT renames, removes, or reorders tasks. id is also the retry key.
export const storeVisits = pgTable('store_visits', {
  id: text('id').primaryKey(),
  storeId: integer('store_id').references(() => stores.id).notNull(),
  visitedBy: text('visited_by').references(() => users.id).notNull(),
  visitedAt: timestamp('visited_at', { withTimezone: true }).defaultNow().notNull(),
  photoUrl: text('photo_url').notNull(),
  photoGeo: jsonb('photo_geo').$type<VisitPhotoGeo>().notNull(),
  lat: decimal('lat', { precision: 10, scale: 7 }).notNull(),
  lng: decimal('lng', { precision: 10, scale: 7 }).notNull(),
  accuracy: decimal('accuracy', { precision: 8, scale: 2 }).notNull(),
  distanceM: integer('distance_m').notNull(),
  tasks: jsonb('tasks').$type<VisitTask[]>().notNull(),
  answers: jsonb('answers').$type<Record<string, VisitAnswer>>().notNull(),
  notes: text('notes').default('').notNull(),
}, (t) => [index('store_visits_store_date_idx').on(t.storeId, t.visitedAt)]);
