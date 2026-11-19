// lib/db/utils/break-reminders.ts
//
// "Come back and check in" reminders for employees on a break. Once an open
// break (break_sessions.return_time NULL, attendance still on_break and not
// checked out) has run BREAK_REMINDER_MINUTES, the employee gets ONE bell
// notification per break (notifications.related_type = 'break_session',
// related_id = the break). Every shift's breaks are covered — a full-day
// shift's two breaks each get their own.
//
// No timer runs per break: the reminder is created lazily whenever the
// employee's app asks (the bell's 60 s poll, the attendance read) and by the
// 5-minute cron /api/cron/break-reminders as the safety net, so it shows up
// at most a minute or so late while the app is open. When the employee comes
// back (endBreak) the reminder is marked read.

import { db } from '@/lib/db';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { attendance, breakSessions, notifications } from '@/lib/db/schema';
import {
  BREAK_REMINDER_MINUTES,
  BREAK_REMINDER_RELATED_TYPE,
  BREAK_REMINDER_TYPE,
  breakReminderText,
} from '@/lib/break-reminder';

/** A break older than this is stale (shift long over) — never remind for it. */
const STALE_AFTER_HOURS = 16;

/**
 * Creates the reminder for every due open break (only `userId`'s when given)
 * that has none yet. Returns how many were created. Never throws.
 */
export async function sendDueBreakReminders(opts: { userId?: string } = {}): Promise<{ sent: number }> {
  try {
    const now = new Date();
    const dueBefore = new Date(now.getTime() - BREAK_REMINDER_MINUTES * 60_000);
    const staleBefore = new Date(now.getTime() - STALE_AFTER_HOURS * 3_600_000);

    const due = await db
      .select({
        breakId: breakSessions.id,
        userId: breakSessions.userId,
        breakOutTime: breakSessions.breakOutTime,
      })
      .from(breakSessions)
      .innerJoin(attendance, eq(attendance.id, breakSessions.attendanceId))
      .where(and(
        isNull(breakSessions.returnTime),
        lte(breakSessions.breakOutTime, dueBefore),
        gte(breakSessions.breakOutTime, staleBefore),
        eq(attendance.onBreak, true),
        isNull(attendance.checkOutTime),
        opts.userId ? eq(breakSessions.userId, opts.userId) : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM ${notifications} n
          WHERE n.related_type = ${BREAK_REMINDER_RELATED_TYPE}
            AND n.related_id = ${breakSessions.id}
        )`,
      ))
      .limit(500);

    if (!due.length) return { sent: 0 };

    let sent = 0;
    // Same encoding Drizzle writes for a timestamp column (UTC ISO), so the
    // bell's "x minutes ago" reads it like every other notification.
    const createdAt = new Date().toISOString();
    for (const row of due) {
      const { title, body } = breakReminderText(row.breakOutTime);
      // Re-checked inside the insert so the cron and a bell poll running at
      // the same moment don't both add one.
      const inserted = await db.execute(sql`
        INSERT INTO ${notifications} (user_id, type, title, body, link, related_type, related_id, is_read, created_at)
        SELECT ${row.userId}, ${BREAK_REMINDER_TYPE}, ${title}, ${body}, ${'/employee/attendance'},
               ${BREAK_REMINDER_RELATED_TYPE}, ${row.breakId}, false, ${createdAt}::timestamp
        WHERE NOT EXISTS (
          SELECT 1 FROM ${notifications} n
          WHERE n.related_type = ${BREAK_REMINDER_RELATED_TYPE} AND n.related_id = ${row.breakId}
        )
      `);
      sent += Number((inserted as { rowCount?: number | null }).rowCount ?? 0);
    }
    return { sent };
  } catch (err) {
    console.error('[sendDueBreakReminders]', err);
    return { sent: 0 };
  }
}

/** The employee is back: their reminder for that break no longer needs attention. */
export async function settleBreakReminder(breakSessionId: number): Promise<void> {
  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(notifications.relatedType, BREAK_REMINDER_RELATED_TYPE),
        eq(notifications.relatedId, breakSessionId),
        eq(notifications.isRead, false),
      ));
  } catch (err) {
    console.error('[settleBreakReminder]', err);
  }
}
