// app/api/pic/schedule/entry/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { createMonthlyScheduleEntry, dateToYearMonth } from '@/lib/schedule-utils';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id          as string;
  const employeeType   = user.employeeType as string | null;
  const role           = user.role         as string;
  const rawHomeStoreId = user.homeStoreId  as string | number | null | undefined;

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can create schedule entries.' }, { status: 403 });
  }
  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { userId, date, shift, isOff, isLeave } = body as {
    userId?:  string;
    date?:    string;    // ISO 'YYYY-MM-DD' or full ISO
    shift?:   'morning' | 'evening' | null;
    isOff?:   boolean;
    isLeave?: boolean;
  };

  if (!userId) return NextResponse.json({ success: false, error: 'userId required.' }, { status: 400 });
  if (!date)   return NextResponse.json({ success: false, error: 'date required.' },   { status: 400 });

  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  const yearMonth = dateToYearMonth(parsedDate);

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

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}