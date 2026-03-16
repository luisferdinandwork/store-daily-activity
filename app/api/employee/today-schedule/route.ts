// app/api/employee/today-schedule/route.ts
import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { db }                from '@/lib/db';
import { schedules, stores } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,  0,  0,   0); return r; }
function endOfDay  (d: Date) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user    = session.user as any;
  const userId  = user.id          as string;
  const storeId = user.homeStoreId as string | null;

  if (!storeId) return NextResponse.json({ shift: null, storeName: null });

  const now = new Date();

  // Get today's schedule row for this employee
  const [sched] = await db
    .select({ shift: schedules.shift, storeId: schedules.storeId })
    .from(schedules)
    .where(and(
      eq(schedules.userId,    userId),
      eq(schedules.storeId,   storeId),
      eq(schedules.isHoliday, false),
      gte(schedules.date,     startOfDay(now)),
      lte(schedules.date,     endOfDay(now)),
    ))
    .limit(1);

  // Get store name
  const [store] = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  return NextResponse.json({
    shift:     sched?.shift  ?? null,
    storeName: store?.name   ?? null,
  });
}