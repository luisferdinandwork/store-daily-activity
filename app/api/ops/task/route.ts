// app/api/ops/tasks/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// All three routes are in this file for convenience.
// Split them into their own files at the paths above when adding to your project.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { storeOpeningTasks, groomingTasks, users, stores, areas } from '@/lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { canManageSchedule, getStoresForOps } from '@/lib/schedule-utils';

// ─── Shared ───────────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

async function getOpsStoreIds(userId: string): Promise<string[]> {
  return getStoresForOps(userId);
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/ops/tasks/store-opening?date=YYYY-MM-DD&storeId=
// ══════════════════════════════════════════════════════════════════════════════
export async function GET_StoreOpening(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const storeIdParam = searchParams.get('storeId');

  const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
  const dayStart = startOfDay(targetDate);
  const dayEnd   = endOfDay(targetDate);

  const opsStoreIds = await getOpsStoreIds(session.user.id);
  if (!opsStoreIds.length) return NextResponse.json({ success: true, data: [], stores: [] });

  const storeIds = storeIdParam && opsStoreIds.includes(storeIdParam)
    ? [storeIdParam]
    : opsStoreIds;

  const rows = await db
    .select({
      task: storeOpeningTasks,
      user: { id: users.id, name: users.name },
      store: { id: stores.id, name: stores.name },
    })
    .from(storeOpeningTasks)
    .leftJoin(users,  eq(storeOpeningTasks.userId,  users.id))
    .leftJoin(stores, eq(storeOpeningTasks.storeId, stores.id))
    .where(
      and(
        inArray(storeOpeningTasks.storeId, storeIds),
        gte(storeOpeningTasks.date, dayStart),
        lte(storeOpeningTasks.date, dayEnd),
      ),
    )
    .orderBy(stores.name, users.name);

  const storeList = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(inArray(stores.id, opsStoreIds));

  const data = rows.map(({ task, user, store }) => ({
    id:               task.id,
    userId:           task.userId,
    userName:         user?.name ?? '—',
    storeId:          task.storeId,
    storeName:        store?.name ?? '—',
    date:             task.date.toISOString(),
    shift:            task.shift,
    status:           task.status,
    completedAt:      task.completedAt?.toISOString()  ?? null,
    cashDrawerAmount: task.cashDrawerAmount,
    allLightsOn:      task.allLightsOn,
    cleanlinessCheck: task.cleanlinessCheck,
    equipmentCheck:   task.equipmentCheck,
    stockCheck:       task.stockCheck,
    safetyCheck:      task.safetyCheck,
    storeFrontPhotos: parsePhotos(task.storeFrontPhotos),
    cashDrawerPhotos: parsePhotos(task.cashDrawerPhotos),
    verifiedBy:       task.verifiedBy,
    verifiedAt:       task.verifiedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ success: true, data, stores: storeList });
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/ops/tasks/grooming?date=YYYY-MM-DD&storeId=
// ══════════════════════════════════════════════════════════════════════════════
export async function GET_Grooming(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam    = searchParams.get('date');
  const storeIdParam = searchParams.get('storeId');

  const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
  const dayStart = startOfDay(targetDate);
  const dayEnd   = endOfDay(targetDate);

  const opsStoreIds = await getOpsStoreIds(session.user.id);
  if (!opsStoreIds.length) return NextResponse.json({ success: true, data: [], stores: [] });

  const storeIds = storeIdParam && opsStoreIds.includes(storeIdParam)
    ? [storeIdParam]
    : opsStoreIds;

  const rows = await db
    .select({
      task: groomingTasks,
      user: { id: users.id, name: users.name },
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
    userName:             user?.name ?? '—',
    storeId:              task.storeId,
    storeName:            store?.name ?? '—',
    date:                 task.date.toISOString(),
    shift:                task.shift,
    status:               task.status,
    completedAt:          task.completedAt?.toISOString()  ?? null,
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

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/ops/tasks/verify
// Body: { taskType: 'store_opening' | 'grooming', taskId: string }
// ══════════════════════════════════════════════════════════════════════════════
export async function POST_Verify(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskType, taskId } = await request.json();
  if (!taskType || !taskId) {
    return NextResponse.json({ error: 'taskType and taskId are required' }, { status: 400 });
  }

  const verifiedBy = session.user.id;
  const now = new Date();

  if (taskType === 'store_opening') {
    const [row] = await db
      .select({ storeId: storeOpeningTasks.storeId, status: storeOpeningTasks.status })
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.id, taskId))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (row.status !== 'completed') {
      return NextResponse.json({ error: 'Only completed tasks can be verified' }, { status: 400 });
    }

    const auth = await canManageSchedule(verifiedBy, row.storeId);
    if (!auth.allowed) return NextResponse.json({ error: auth.reason }, { status: 403 });

    await db
      .update(storeOpeningTasks)
      .set({ verifiedBy, verifiedAt: now, updatedAt: now })
      .where(eq(storeOpeningTasks.id, taskId));

  } else if (taskType === 'grooming') {
    const [row] = await db
      .select({ storeId: groomingTasks.storeId, status: groomingTasks.status })
      .from(groomingTasks)
      .where(eq(groomingTasks.id, taskId))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (row.status !== 'completed') {
      return NextResponse.json({ error: 'Only completed tasks can be verified' }, { status: 400 });
    }

    const auth = await canManageSchedule(verifiedBy, row.storeId);
    if (!auth.allowed) return NextResponse.json({ error: auth.reason }, { status: 403 });

    await db
      .update(groomingTasks)
      .set({ verifiedBy, verifiedAt: now, updatedAt: now })
      .where(eq(groomingTasks.id, taskId));

  } else {
    return NextResponse.json({ error: `Unknown taskType: ${taskType}` }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}