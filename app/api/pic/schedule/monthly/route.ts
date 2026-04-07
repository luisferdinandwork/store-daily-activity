// app/api/pic/schedule/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  getMonthlySchedule,
  deleteMonthlySchedule,
  createEmptyMonthlySchedule,
} from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { users, userRoles, employeeTypes, shifts } from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';

/** Resolve the actor's role code and employeeType code from the DB. */
async function resolveActorCodes(userId: string): Promise<{ role: string | null; empType: string | null }> {
  const [row] = await db
    .select({ roleCode: userRoles.code, empTypeCode: employeeTypes.code })
    .from(users)
    .leftJoin(userRoles,      eq(users.roleId,         userRoles.id))
    .leftJoin(employeeTypes,  eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);
  return { role: row?.roleCode ?? null, empType: row?.empTypeCode ?? null };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth      = req.nextUrl.searchParams.get('yearMonth');

  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth)      return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  const rawSchedule = await getMonthlySchedule(storeId, yearMonth);

  if (!rawSchedule) {
    return NextResponse.json({ success: true, schedule: null });
  }

  // ── Map over entries to append shift code string for the frontend ──
  const mappedEntries = await Promise.all(
    rawSchedule.entries.map(async (entry) => {
      let shift: string | null = null;
      
      // Fetch the shift code string if shiftId exists
      if (entry.shiftId) {
        const [shiftRow] = await db
          .select({ code: shifts.code })
          .from(shifts)
          .where(eq(shifts.id, entry.shiftId))
          .limit(1);
        shift = shiftRow?.code ?? null;
      }

      return {
        id: String(entry.id),
        userId: entry.userId,
        userName: entry.userName,
        userType: entry.userEmployeeType, // Notice mapping from userEmployeeType -> userType
        date: entry.date,
        shiftId: entry.shiftId,
        shift: shift as 'morning' | 'evening' | null,
        isOff: entry.isOff,
        isLeave: entry.isLeave,
      };
    })
  );

  const schedule = {
    ...rawSchedule.schedule,
    id: String(rawSchedule.schedule.id),
    storeId: String(rawSchedule.schedule.storeId),
    entries: mappedEntries,
  };

  return NextResponse.json({ success: true, schedule });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;

  const { role, empType } = await resolveActorCodes(actorId);
  if (role !== 'ops' && empType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can create schedules.' }, { status: 403 });
  }
  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  const body      = await req.json().catch(() => ({}));
  const yearMonth = body.yearMonth as string | undefined;
  const note      = body.note      as string | undefined;

  if (!yearMonth) return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const result = await createEmptyMonthlySchedule(storeId, yearMonth, actorId, note);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth      = req.nextUrl.searchParams.get('yearMonth');

  const { role, empType } = await resolveActorCodes(actorId);
  if (role !== 'ops' && empType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can delete schedules.' }, { status: 403 });
  }
  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth)      return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  console.log('[DELETE monthly]', { storeId, yearMonth });

  const result = await deleteMonthlySchedule(storeId, yearMonth, actorId);

  console.log('[DELETE monthly] result:', result);

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}