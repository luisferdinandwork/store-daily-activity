// lib/db/utils/notifications.ts
import { db } from '@/lib/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { notifications, users, employeeTypes, type Notification } from '@/lib/db/schema';

/**
 * Every active user directly assigned to `roleId` — no area scoping.
 * Use `getOpsUserIdsForArea` instead for the Ops role, which is area-scoped.
 */
export async function getUserIdsForRole(roleId: number): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.roleId, roleId), eq(users.isActive, true)));

  return rows.map((row) => row.id);
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  relatedType?: string;
  relatedId?: number;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await db.insert(notifications).values(input);
}

export async function createNotificationsForUsers(
  userIds: string[],
  input: Omit<CreateNotificationInput, 'userId'>,
): Promise<void> {
  if (!userIds.length) return;
  await db.insert(notifications).values(userIds.map((userId) => ({ ...input, userId })));
}

/**
 * Resolves which OPS users should be notified about an event happening at
 * `storeAreaId` — every ops_ho (sees all stores) plus every ops_area whose
 * own areaId matches the store's area.
 */
export async function getOpsUserIdsForArea(storeAreaId: number | null): Promise<string[]> {
  const rows = await db
    .select({ id: users.id, employeeTypeCode: employeeTypes.code, areaId: users.areaId })
    .from(users)
    .innerJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.isActive, true));

  return rows
    .filter((row) => {
      if (row.employeeTypeCode === 'ops_ho') return true;
      if (row.employeeTypeCode === 'ops_area') return storeAreaId != null && row.areaId === storeAreaId;
      return false;
    })
    .map((row) => row.id);
}

export async function listNotifications(userId: string, limit = 30): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return rows.length;
}

export async function markNotificationRead(userId: string, id: number): Promise<void> {
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}

/**
 * Removes notifications tied to a specific entity (e.g. a schedule that was
 * auto-marked absent) once that entity's underlying issue has been resolved
 * — e.g. an ops user records the employee's real attendance status.
 */
export async function deleteNotificationsByRelated(relatedType: string, relatedId: number): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.relatedType, relatedType), eq(notifications.relatedId, relatedId)));
}

/**
 * Housekeeping: notifications the user has already read stick around for a
 * grace period, then get purged so the inbox doesn't grow forever.
 */
export async function deleteReadNotificationsOlderThan(days: number): Promise<{ deleted: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const deleted = await db
    .delete(notifications)
    .where(and(eq(notifications.isRead, true), lt(notifications.readAt, cutoff)))
    .returning({ id: notifications.id });

  return { deleted: deleted.length };
}
