// lib/db/utils/account.ts
//
// Self-service account actions shared by every role. Right now just the
// "change my own password" flow, used by both the employee endpoint and the
// generic /api/account endpoint the Ops/Finance/Audit panels call.

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clearPasswordExpiryReminders } from './password-policy';

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: string; status: number };

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (!currentPassword) {
    return { success: false, error: 'Current password is required.', status: 400 };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`, status: 400 };
  }

  const [user] = await db
    .select({ id: users.id, password: users.password })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { success: false, error: 'User not found.', status: 404 };
  }

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) {
    return { success: false, error: 'Current password is incorrect.', status: 401 };
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return { success: false, error: 'New password must be different from the current one.', status: 400 };
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const now = new Date();
  await db
    .update(users)
    .set({ password: hashed, passwordChangedAt: now, updatedAt: now })
    .where(eq(users.id, userId));
  // Drop any 90-day expiry reminders now that the password is fresh.
  await clearPasswordExpiryReminders(userId);

  return { success: true };
}
