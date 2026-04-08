// app/api/ops/schedules/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  getMonthlySchedule,
  deleteMonthlySchedule,
  createEmptyMonthlySchedule,
} from '@/lib/schedule-utils';
import { db }                        from '@/lib/db';
import { shifts }                    from '@/lib/db/schema';
import { eq }                        from 'drizzle-orm';
import { getOpsActor, assertStoreInActorArea, parseStoreId } from '../_helpers';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const storeIdRaw = req.nextUrl.searchParams.get('storeId');
  const yearMonth  = req.nextUrl.searchParams.get('yearMonth');

  const parsed = parseStoreId(storeIdRaw);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  if (!yearMonth)  return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, parsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const rawSchedule = await getMonthlySchedule(parsed.id, yearMonth);
  if (!rawSchedule) return NextResponse.json({ success: true, schedule: null });

  // Append shift code per entry (mirrors the PIC route)
  const mappedEntries = await Promise.all(
    rawSchedule.entries.map(async (entry) => {
      let shiftCode: string | null = null;
      if (entry.shiftId) {
        const [row] = await db
          .select({ code: shifts.code })
          .from(shifts)
          .where(eq(shifts.id, entry.shiftId))
          .limit(1);
        shiftCode = row?.code ?? null;
      }
      return {
        id:       String(entry.id),
        userId:   entry.userId,
        userName: entry.userName,
        userType: entry.userEmployeeType,
        date:     entry.date,
        shiftId:  entry.shiftId,
        shift:    shiftCode as 'morning' | 'evening' | null,
        isOff:    entry.isOff,
        isLeave:  entry.isLeave,
      };
    }),
  );

  return NextResponse.json({
    success: true,
    schedule: {
      ...rawSchedule.schedule,
      id:      String(rawSchedule.schedule.id),
      storeId: String(rawSchedule.schedule.storeId),
      entries: mappedEntries,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const body      = await req.json().catch(() => ({}));
  const parsed    = parseStoreId(body.storeId);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const yearMonth = body.yearMonth as string | undefined;
  const note      = body.note      as string | undefined;
  if (!yearMonth) return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, parsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const result = await createEmptyMonthlySchedule(parsed.id, yearMonth, actor.id, note);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const storeIdRaw = req.nextUrl.searchParams.get('storeId');
  const yearMonth  = req.nextUrl.searchParams.get('yearMonth');

  const parsed = parseStoreId(storeIdRaw);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  if (!yearMonth)  return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const areaErr = await assertStoreInActorArea(actor, parsed.id);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const result = await deleteMonthlySchedule(parsed.id, yearMonth, actor.id);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}