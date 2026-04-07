// app/api/employee/today-schedule/route.ts
import { NextResponse }               from 'next/server';
import { getServerSession }           from 'next-auth';
import { authOptions }                from '@/lib/auth';
import { db }                         from '@/lib/db';
import { schedules, stores, shifts }  from '@/lib/db/schema';
import { eq, and, gte, lte }          from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const userId         = user.id          as string;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;

  if (!rawHomeStoreId) return NextResponse.json({ shift: null, storeName: null });

  const homeStoreId = Number(rawHomeStoreId);
  if (isNaN(homeStoreId)) return NextResponse.json({ shift: null, storeName: null });

  const now = new Date();

  // Fetch today's schedule joined with the shift lookup so we get the code
  const [sched] = await db
    .select({ shiftId: schedules.shiftId, storeId: schedules.storeId })
    .from(schedules)
    .where(and(
      eq(schedules.userId,    userId),
      eq(schedules.storeId,   homeStoreId),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     startOfDay(now)),
      lte(schedules.date,     endOfDay(now)),
    ))
    .limit(1);

  // Resolve the shift code from the lookup table
  let shiftCode: string | null = null;
  if (sched?.shiftId) {
    const [shiftRow] = await db
      .select({ code: shifts.code })
      .from(shifts)
      .where(eq(shifts.id, sched.shiftId))
      .limit(1);
    shiftCode = shiftRow?.code ?? null;
  }

  const [store] = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, homeStoreId))
    .limit(1);

  return NextResponse.json({
    shift:     shiftCode,
    storeName: store?.name ?? null,
  });
}