// app/api/pic/schedule/_utils.ts
import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isDayKey, jakartaDayStart } from '@/lib/day-bucket';

export async function resolveActorCodes(
  userId: string,
): Promise<{ role: string | null; empType: string | null }> {
  const [row] = await db
    .select({
      roleCode: userRoles.code,
      empTypeCode: employeeTypes.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);

  return {
    role: row?.roleCode ?? null,
    empType: row?.empTypeCode ?? null,
  };
}

/**
 * May VIEW the store schedule (PIC + every Ops/IT manager). Also gates the
 * roster + shift lookups the PIC panel needs to render the read-only grid.
 */
export function canManageSchedule(role: string | null, empType: string | null) {
  return (
    role === 'it' ||
    role === 'ops' ||
    empType === 'pic_1' ||
    empType === 'pic_2' ||
    empType === 'ops_area' ||
    empType === 'ops_ho'
  );
}

/**
 * May CHANGE the store schedule from inside the system — create an empty month,
 * edit a day cell, or delete a schedule. Ops/IT only: PIC can no longer create,
 * edit, or delete schedule entries/months — their only remaining write path is
 * the Excel import route (see app/api/pic/schedule/import/route.ts), which is
 * gated separately and blocked outright if a schedule already exists.
 */
export function canEditSchedule(role: string | null, empType: string | null) {
  return (
    role === 'it' ||
    role === 'ops' ||
    empType === 'ops_area' ||
    empType === 'ops_ho'
  );
}

/** "YYYY-MM-DD" → that Jakarta day's bucket instant (lib/day-bucket.ts); other strings are parsed as-is. */
export function parseLocalDate(date: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return isDayKey(date) ? jakartaDayStart(date) : null;
  }

  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}