// lib/db/schema/feature-switches.ts
//
// On/off switches IT flips from /it/feature-switches. One row per switch that
// IT has ever touched; a missing row means the switch's default from
// lib/feature-switches.ts (where every switch is declared).

import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './core';

export const featureSwitches = pgTable('feature_switches', {
  /** A key of FEATURE_SWITCHES in lib/feature-switches.ts. */
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type FeatureSwitchRow = typeof featureSwitches.$inferSelect;
