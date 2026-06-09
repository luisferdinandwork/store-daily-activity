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

export function canManageSchedule(role: string | null, empType: string | null) {
  return (
    role === 'admin' ||
    role === 'ops' ||
    empType === 'pic_1' ||
    empType === 'ops_area' ||
    empType === 'ops_ho'
  );
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