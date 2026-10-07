// lib/db/schema/password-reset.ts
//
// "Lupa password" requests. Flow (lib/db/utils/password-reset.ts):
//
//   pending    — staff asked from the login screen with NIK + store email; the
//                store mailbox got a "request received" email
//   link_sent  — IT verified it and emailed a one-time link to the store
//                mailbox. Only the requesting NIK can use it (typing another
//                NIK counts as a failed attempt; too many locks the link).
//   completed  — the password was changed through the link
//   rejected   — IT turned the request down (or withdrew the link)
//   cancelled  — superseded: a newer link or request for the same user replaced it
//
// "expired" and "locked" are derived from link_sent (token_expires_at /
// failed_attempts), never stored. Only the SHA-256 of the link token is kept.

import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { stores, users } from './core';

export type PasswordResetStoredStatus = 'pending' | 'link_sent' | 'completed' | 'rejected' | 'cancelled';

export const passwordResetRequests = pgTable(
  'password_reset_requests',
  {
    id: serial('id').primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    /** NIK and store as they were when the request came in. */
    nik: text('nik').notNull(),
    storeId: integer('store_id').references(() => stores.id, { onDelete: 'set null' }),
    /** Store mailbox the requester typed (matched stores.email); every email for this request goes here. */
    email: text('email').notNull(),

    status: text('status').$type<PasswordResetStoredStatus>().default('pending').notNull(),

    requestIp: text('request_ip'),
    userAgent: text('user_agent'),

    tokenHash: text('token_hash'),
    tokenExpiresAt: timestamp('token_expires_at'),
    linkSentAt: timestamp('link_sent_at'),
    linkSentBy: text('link_sent_by').references(() => users.id, { onDelete: 'set null' }),
    /** Wrong-NIK attempts on the current link. */
    failedAttempts: integer('failed_attempts').default(0).notNull(),

    completedAt: timestamp('completed_at'),
    completedIp: text('completed_ip'),

    rejectedAt: timestamp('rejected_at'),
    rejectedBy: text('rejected_by').references(() => users.id, { onDelete: 'set null' }),
    rejectReason: text('reject_reason'),

    /** Last email that could not be delivered for this request (null once one succeeds). */
    lastEmailError: text('last_email_error'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('password_reset_requests_user_idx').on(t.userId),
    statusIdx: index('password_reset_requests_status_idx').on(t.status),
    tokenHashUnique: uniqueIndex('password_reset_requests_token_hash_unique').on(t.tokenHash),
  }),
);

export type PasswordResetRequest = typeof passwordResetRequests.$inferSelect;
