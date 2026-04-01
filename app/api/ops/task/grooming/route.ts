// app/api/ops/tasks/grooming/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { groomingTasks, users, stores } from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { getStoresForOps, startOfDay, endOfDay } from '@/lib/schedule-utils';

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

// ─── GET /api/ops/tasks/grooming?date=YYYY-MM-DD&storeId= ────────────────────
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateParam    = searchParams.get('date');
  const storeIdParam = searchParams.get('storeId');

  const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
  const dayStart   = startOfDay(targetDate);
  const dayEnd     = endOfDay(targetDate);

  const opsStoreIds = await getStoresForOps(session.user.id);
  if (!opsStoreIds.length) {
    return NextResponse.json({ success: true, data: [], stores: [] });
  }

  const storeIds = storeIdParam && opsStoreIds.includes(storeIdParam)
    ? [storeIdParam]
    : opsStoreIds;

  const rows = await db
    .select({
      task:  groomingTasks,
      user:  { id: users.id,  name: users.name  },
      store: { id: stores.id, name: stores.name },
    })
    .from(groomingTasks)
    .leftJoin(users,  eq(groomingTasks.userId,  users.id))
    .leftJoin(stores, eq(groomingTasks.storeId, stores.id))
    .where(
      and(
        inArray(groomingTasks.storeId, storeIds),
        gte(groomingTasks.date, dayStart),
        lte(groomingTasks.date, dayEnd),
      ),
    )
    .orderBy(stores.name, users.name);

  const storeList = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(inArray(stores.id, opsStoreIds));

  const data = rows.map(({ task, user, store }) => ({
    id:                   task.id,
    userId:               task.userId,
    userName:             user?.name  ?? '—',
    storeId:              task.storeId,
    storeName:            store?.name ?? '—',
    date:                 task.date.toISOString(),
    shift:                task.shift,
    status:               task.status,
    completedAt:          task.completedAt?.toISOString() ?? null,
    uniformComplete:      task.uniformComplete,
    hairGroomed:          task.hairGroomed,
    nailsClean:           task.nailsClean,
    accessoriesCompliant: task.accessoriesCompliant,
    shoeCompliant:        task.shoeCompliant,
    selfiePhotos:         parsePhotos(task.selfiePhotos),
    verifiedBy:           task.verifiedBy,
    verifiedAt:           task.verifiedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ success: true, data, stores: storeList });
}