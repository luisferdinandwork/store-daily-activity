// lib/db/schema/manuals.ts
//
// Knowledge Manual library — store-operations manuals (PDF/Word/Excel/image)
// uploaded by Ops HO/admin, visible to every employee. See
// app/api/upload/manual/route.ts for the upload endpoint and
// app/employee/knowledge/page.tsx for the employee-facing viewer.

import { pgTable, serial, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './core';

export const manuals = pgTable('manuals', {
  id: serial('id').primaryKey(),

  title:       text('title').notNull(),
  description: text('description'),

  fileUrl:  text('file_url').notNull(),
  fileType: text('file_type').notNull(), // extension, e.g. 'pdf'

  uploadedBy: text('uploaded_by').references(() => users.id).notNull(),

  isActive:  boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Manual = typeof manuals.$inferSelect;
export type NewManual = typeof manuals.$inferInsert;
