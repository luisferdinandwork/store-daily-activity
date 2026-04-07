// app/api/pic/schedule/entry/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { createMonthlyScheduleEntry, dateToYearMonth } from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';

async function resolveActorCodes(userId: string): Promise<{ role: string | null; empType: string | null }> {
  const [row] = await db
    .select({ roleCode: userRoles.code, empTypeCode: employeeTypes.code })
    .from(users)
    .leftJoin(userRoles,     eq(users.roleId,         userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);
  return { role: row?.roleCode ?? null, empType: row?.empTypeCode ?? null };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;

  const { role, empType } = await resolveActorCodes(actorId);
  if (role !== 'ops' && empType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can create schedule entries.' }, { status: 403 });
  }
  if (!rawHomeStoreId) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  console.log('[POST /api/pic/schedule/entry] body:', body, 'storeId:', storeId);

  const { userId, date, shift, isOff, isLeave } = body as {
    userId?:  string;
    date?:    string;
    shift?:   'morning' | 'evening' | null;
    isOff?:   boolean;
    isLeave?: boolean;
  };

  if (!userId) {
    console.log('[POST /api/pic/schedule/entry] ❌ missing userId');
    return NextResponse.json({ success: false, error: 'userId required.' }, { status: 400 });
  }
  if (!date) {
    console.log('[POST /api/pic/schedule/entry] ❌ missing date');
    return NextResponse.json({ success: false, error: 'date required.' }, { status: 400 });
  }

  // Parse YYYY-MM-DD as a LOCAL date, not UTC.
  let parsedDate: Date;
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    parsedDate = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  } else {
    parsedDate = new Date(date);
  }

  if (isNaN(parsedDate.getTime())) {
    console.log('[POST /api/pic/schedule/entry] ❌ invalid date:', date);
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  const yearMonth = dateToYearMonth(parsedDate);
  console.log('[POST /api/pic/schedule/entry] parsedDate:', parsedDate.toISOString(), 'yearMonth:', yearMonth);

  const result = await createMonthlyScheduleEntry(
    storeId,
    yearMonth,
    userId,
    parsedDate,
    {
      shift:   shift   ?? null,
      isOff:   !!isOff,
      isLeave: !!isLeave,
    },
    actorId,
  );

  console.log('[POST /api/pic/schedule/entry] result:', result);

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}