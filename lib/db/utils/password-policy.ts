// lib/db/utils/password-policy.ts
//
// 90-day "please change your password" policy. Every role EXCEPT `it` is
// nudged (a persistent notification + a non-dismissible banner) once their
// password is older than PASSWORD_MAX_AGE_DAYS. Nothing is blocked — the user
// keeps full access, they just get pestered until they rotate it.
//
// - `password_changed_at` on `users` is the clock (set on self-service change
//   and on admin resets; defaults to now() for new/existing rows).
// - The daily cron `/api/cron/password-expiry-check` calls
//   `notifyUsersWithExpiredPasswords()` to drop one inbox notification per
//   overdue user (deduped against an existing unread one).
// - `getPasswordStatus()` backs the banner + `/api/account/password-status`.

import { db } from '@/lib/db';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import { notifications, userRoles, users } from '@/lib/db/schema';
import { createNotificationsForUsers } from './notifications';

export const PASSWORD_MAX_AGE_DAYS = 90;

/** Roles that never get nagged. IT accounts are shared/service-ish. */
export const PASSWORD_EXEMPT_ROLE_CODES = ['it'] as const;

export const PASSWORD_EXPIRY_NOTIFICATION_TYPE = 'password_expiry';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where each role's "change my password" screen lives. */
const CHANGE_PASSWORD_PATH_BY_ROLE: Record<string, string> = {
  employee: '/employee/settings',
  ops: '/ops/settings',
  finance: '/finance/settings',
  audit: '/audit/settings',
};

export function changePasswordPathForRole(roleCode: string | null | undefined): string {
  return (roleCode && CHANGE_PASSWORD_PATH_BY_ROLE[roleCode]) || '/employee/settings';
}

export function isRoleExemptFromPasswordPolicy(roleCode: string | null | undefined): boolean {
  return !!roleCode && (PASSWORD_EXEMPT_ROLE_CODES as readonly string[]).includes(roleCode);
}

export function passwordAgeInDays(passwordChangedAt: Date): number {
  return Math.floor((Date.now() - passwordChangedAt.getTime()) / DAY_MS);
}

export interface PasswordStatus {
  /** True once the password is older than the max age and the role isn't exempt. */
  expired: boolean;
  /** Whole days since the password was last changed. */
  ageDays: number;
  /** Days past the 90-day limit (0 when not expired). */
  overdueDays: number;
  /** The role is on the exemption list — never nagged. */
  exempt: boolean;
  maxAgeDays: number;
  /** Role-appropriate route to the change-password screen. */
  changePath: string;
}

/** Password status for one user — used by the banner + status API. */
export async function getPasswordStatus(userId: string): Promise<PasswordStatus | null> {
  const [row] = await db
    .select({
      passwordChangedAt: users.passwordChangedAt,
      roleCode: userRoles.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const exempt = isRoleExemptFromPasswordPolicy(row.roleCode);
  const ageDays = passwordAgeInDays(row.passwordChangedAt);
  const overdueDays = Math.max(0, ageDays - PASSWORD_MAX_AGE_DAYS);

  return {
    expired: !exempt && overdueDays > 0,
    ageDays,
    overdueDays,
    exempt,
    maxAgeDays: PASSWORD_MAX_AGE_DAYS,
    changePath: changePasswordPathForRole(row.roleCode),
  };
}

/**
 * Daily cron entry point. Finds every active non-exempt user whose password is
 * past the limit and, unless they already have an unread reminder sitting in
 * their inbox, drops a fresh one linking to their change-password screen.
 * Returns how many notifications were created.
 */
export async function notifyUsersWithExpiredPasswords(): Promise<{ notified: number; overdue: number }> {
  const cutoff = new Date(Date.now() - PASSWORD_MAX_AGE_DAYS * DAY_MS);

  const overdueUsers = await db
    .select({ id: users.id, roleCode: userRoles.code })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(
      and(
        eq(users.isActive, true),
        lt(users.passwordChangedAt, cutoff),
        ...PASSWORD_EXEMPT_ROLE_CODES.map((code) => ne(userRoles.code, code)),
      ),
    );

  if (!overdueUsers.length) return { notified: 0, overdue: 0 };

  const overdueIds = overdueUsers.map((u) => u.id);

  // Skip anyone who still has an unread reminder — don't stack duplicates.
  const existing = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, PASSWORD_EXPIRY_NOTIFICATION_TYPE),
        eq(notifications.isRead, false),
        inArray(notifications.userId, overdueIds),
      ),
    );
  const alreadyNudged = new Set(existing.map((r) => r.userId));

  const targets = overdueUsers.filter((u) => !alreadyNudged.has(u.id));
  if (!targets.length) return { notified: 0, overdue: overdueUsers.length };

  // Group by change-password path so each batch shares one link.
  const byPath = new Map<string, string[]>();
  for (const u of targets) {
    const path = changePasswordPathForRole(u.roleCode);
    const list = byPath.get(path) ?? [];
    list.push(u.id);
    byPath.set(path, list);
  }

  for (const [link, ids] of byPath) {
    await createNotificationsForUsers(ids, {
      type: PASSWORD_EXPIRY_NOTIFICATION_TYPE,
      title: 'Kata sandi Anda perlu diganti',
      body: `Kata sandi Anda sudah lebih dari ${PASSWORD_MAX_AGE_DAYS} hari. Demi keamanan, silakan ganti sekarang.`,
      link,
    });
  }

  return { notified: targets.length, overdue: overdueUsers.length };
}

/**
 * Remove any outstanding 90-day expiry reminders from a user's inbox — called
 * right after they change their password (see lib/db/utils/account.ts).
 */
export async function clearPasswordExpiryReminders(userId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, PASSWORD_EXPIRY_NOTIFICATION_TYPE),
      ),
    );
}
