// app/api/ops/tasks/progress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import {
  getAreaTaskOverview,
  getFlatTasksForStoreDate,
  summariseTasks,
} from '@/lib/db/utils/tasks';

import {
  getOpsActor,
  assertStoreInActorArea,
  parseStoreId,
  parseDate,
} from '../_helpers';

function serializeTask(task: Awaited<ReturnType<typeof getFlatTasksForStoreDate>>[number]) {
  return {
    ...task,
    id: String(task.id),
    scheduleId: String(task.scheduleId),
    storeId: String(task.storeId),
  };
}

function completionRate(summary: { total: number; completed: number }) {
  if (summary.total <= 0) return 0;
  return Math.round((summary.completed / summary.total) * 100);
}

function makeEmptyAggregate() {
  return {
    pending: 0,
    inProgress: 0,
    completed: 0,
    discrepancy: 0,
    total: 0,
  };
}

// GET /api/ops/tasks/progress?date=YYYY-MM-DD
// GET /api/ops/tasks/progress?date=YYYY-MM-DD&storeId=1
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const rawDate =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().slice(0, 10);

  const dateParsed = parseDate(rawDate);

  if (!dateParsed.ok) {
    return NextResponse.json(
      { success: false, error: dateParsed.error },
      { status: 400 },
    );
  }

  const rawStoreId = req.nextUrl.searchParams.get('storeId');

  if (rawStoreId) {
    const storeParsed = parseStoreId(rawStoreId);

    if (!storeParsed.ok) {
      return NextResponse.json(
        { success: false, error: storeParsed.error },
        { status: 400 },
      );
    }

    const areaErr = await assertStoreInActorArea(actor, storeParsed.id);

    if (areaErr) {
      return NextResponse.json(
        { success: false, error: areaErr },
        { status: 403 },
      );
    }

    const [storeRow] = await db
      .select({
        id: stores.id,
        name: stores.name,
        address: stores.address,
      })
      .from(stores)
      .where(eq(stores.id, storeParsed.id))
      .limit(1);

    if (!storeRow) {
      return NextResponse.json(
        { success: false, error: 'Store not found.' },
        { status: 404 },
      );
    }

    const tasks = await getFlatTasksForStoreDate(storeParsed.id, dateParsed.date);
    const summary = summariseTasks(tasks);

    return NextResponse.json({
      success: true,
      mode: 'detail',
      date: rawDate,
      store: {
        id: String(storeRow.id),
        name: storeRow.name,
        address: storeRow.address,
      },
      summary: {
        ...summary,
        completionRate: completionRate(summary),
      },
      tasks: tasks.map(serializeTask),
    });
  }

  const overview = await getAreaTaskOverview(actor.id, dateParsed.date);
  const aggregate = makeEmptyAggregate();

  for (const store of overview.stores) {
    aggregate.pending += store.summary.pending;
    aggregate.inProgress += store.summary.inProgress;
    aggregate.completed += store.summary.completed;
    aggregate.discrepancy += store.summary.discrepancy;
    aggregate.total += store.summary.total;
  }

  return NextResponse.json({
    success: true,
    mode: 'overview',
    date: rawDate,
    area: overview.area
      ? {
          id: String(overview.area.id),
          name: overview.area.name,
        }
      : null,
    summary: {
      ...aggregate,
      completionRate: completionRate(aggregate),
    },
    stores: overview.stores.map((store) => ({
      id: String(store.id),
      name: store.name,
      address: store.address,
      summary: {
        ...store.summary,
        completionRate: completionRate(store.summary),
      },
    })),
  });
}
