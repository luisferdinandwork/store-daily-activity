// app/api/ops/schedules/entry/route.ts
import { NextRequest, NextResponse }                 from 'next/server';
import { getServerSession }                          from 'next-auth';
import { authOptions }                               from '@/lib/auth';
import { createMonthlyScheduleEntry, dateToYearMonth } from '@/lib/schedule-utils';
import { getOpsActor, assertStoreInActorArea, parseStoreId } from '../_helpers';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsedStore = parseStoreId(body.storeId);
  if (!parsedStore.ok) return NextResponse.json({ success: false, error: parsedStore.error }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, parsedStore.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const { userId, date, shift, isOff, isLeave } = body as {
    userId?:  string;
    date?:    string;
    shift?:   'morning' | 'evening' | null;
    isOff?:   boolean;
    isLeave?: boolean;
  };

  if (!userId) return NextResponse.json({ success: false, error: 'userId required.' }, { status: 400 });
  if (!date)   return NextResponse.json({ success: false, error: 'date required.' },   { status: 400 });

  // Parse YYYY-MM-DD as LOCAL date (matches PIC route)
  let parsedDate: Date;
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    parsedDate = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  } else {
    parsedDate = new Date(date);
  }
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  const yearMonth = dateToYearMonth(parsedDate);

  const result = await createMonthlyScheduleEntry(
    parsedStore.id,
    yearMonth,
    userId,
    parsedDate,
    {
      shift:   shift   ?? null,
      isOff:   !!isOff,
      isLeave: !!isLeave,
    },
    actor.id,
  );

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}