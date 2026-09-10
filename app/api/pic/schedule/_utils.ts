// app/api/pic/schedule/_utils.ts
import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
 * edit a day cell, delete a schedule, or replace it via Excel import. PIC 1/2
 * manage their own store's schedule; every Ops/IT manager can too.
 */
export function canEditSchedule(role: string | null, empType: string | null) {
  return canManageSchedule(role, empType);
}

export function parseLocalDate(date: string): Date | null {
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}