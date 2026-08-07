// lib/db/schema/notifications.ts
//
// Generic in-app notification inbox. First consumer: OPS being notified of
// petty cash refill requests (scoped: ops_area gets their store's requests,
// ops_ho gets everything) — see lib/db/utils/notifications.ts. Deliberately
// generic (type/title/body/link) so future alerts can reuse the same table
// and the same OpsNavbar bell instead of inventing a new mechanism.

import { pgTable, serial, text, boolean, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { users } from './core';

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

    /** Stable machine key, e.g. 'petty_cash_refill_requested'. */
    type: text('type').notNull(),

    title: text('title').notNull(),
    body: text('body'),

    /** Where clicking the notification should navigate to. */
    link: text('link'),

    /**
     * Optional pointer back to the entity this notification is about, e.g.
     * relatedType: 'schedule', relatedId: <schedules.id>. Lets a later event
     * (an ops user correcting an auto-marked absence) find and remove the
     * notification it made obsolete, without parsing `link`.
     */
    relatedType: text('related_type'),
    relatedId:   integer('related_id'),

    isRead: boolean('is_read').default(false).notNull(),
    readAt: timestamp('read_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userId),
    userUnreadIdx: index('notifications_user_unread_idx').on(t.userId, t.isRead),
    relatedIdx: index('notifications_related_idx').on(t.relatedType, t.relatedId),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
