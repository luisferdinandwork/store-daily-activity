// lib/db/schema/templates.ts
//
// IT-managed templates:
//   • issue_templates — report presets an employee picks in "Report an Issue"
//     (pre-fills title, description and the teams the issue goes to).
//   • email_templates — the subject + HTML of an outgoing email. No row = the
//     built-in default in lib/email/email-templates.ts.

import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

import type { EmailBodyFields } from '@/lib/email/email-templates';

import { users } from './core';

export const issueTemplates = pgTable('issue_templates', {
  id: serial('id').primaryKey(),
  /** Shown on the picker chip, e.g. "Printer rusak". */
  name: text('name').notNull().unique(),
  title: text('title'),
  description: text('description'),
  /** user_roles ids pre-selected under "Send to". Empty = leave the employee's default. */
  assignedRoleIds: integer('assigned_role_ids').array().notNull().default([]),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const emailTemplates = pgTable('email_templates', {
  /** A key of EMAIL_TEMPLATES in lib/email/email-templates.ts. */
  key: text('key').primaryKey(),
  subject: text('subject').notNull(),
  /** 'body' = built from `fields` inside the clean layout; 'html' = `html` is hand-written. */
  mode: text('mode').default('html').notNull(),
  /** Last Body-mode fields (kept while the template is in HTML mode so switching back is lossless). */
  fields: jsonb('fields').$type<EmailBodyFields | null>(),
  html: text('html').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type IssueTemplate = typeof issueTemplates.$inferSelect;
export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
