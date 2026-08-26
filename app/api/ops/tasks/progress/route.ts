// app/api/ops/tasks/progress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq, inArray } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores, users } from '@/lib/db/schema';
import { todayInStoreTimezone } from '@/lib/schedule-utils';
import {
  getAllTaskOverview,
  getAreaTaskOverview,
  getFlatTasksForStoreDate,
  summariseTasks,
} from '@/lib/db/utils/tasks';
import { serializeTask } from '@/lib/db/utils/task-serialize';
import { listSerahTerimaEntries } from '@/lib/db/utils/serah-terima';

import {
  getOpsActor,
  assertStoreInActorArea,
  parseStoreId,
  parseDate,
} from '../_helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskSummary = {
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  verified: number;
  rejected: number;
  total: number;
};

type MaybeTaskSummary = Partial<TaskSummary> & {
  total?: number;
  completed?: number;
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function completionRate(summary: { total: number; completed: number }) {
  if (summary.total <= 0) return 0;
  return Math.round((summary.completed / summary.total) * 100);
}

function makeEmptyAggregate(): TaskSummary {
  return {
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    pending: 0,
    verified: 0,
    rejected: 0,
    total: 0,
  };
}

function normalizeSummary(summary: MaybeTaskSummary): TaskSummary {
  return {
    notStarted: toNumber(summary.notStarted),
    inProgress: toNumber(summary.inProgress),
    completed: toNumber(summary.completed),
    pending: toNumber(summary.pending),
    verified: toNumber(summary.verified),
    rejected: toNumber(summary.rejected),
    total: toNumber(summary.total),
  };
}

function withCompletionRate(summary: MaybeTaskSummary) {
  const normalized = normalizeSummary(summary);

  return {
    ...normalized,
    completionRate: completionRate(normalized),
  };
}

function addToAggregate(aggregate: TaskSummary, summary: MaybeTaskSummary) {
  const normalized = normalizeSummary(summary);

  aggregate.notStarted += normalized.notStarted;
  aggregate.inProgress += normalized.inProgress;
  aggregate.completed += normalized.completed;
  aggregate.pending += normalized.pending;
  aggregate.verified += normalized.verified;
  aggregate.rejected += normalized.rejected;
  aggregate.total += normalized.total;
}

function storeSummaryFromOverviewStore(store: {
  summary: MaybeTaskSummary;
}) {
  return withCompletionRate(store.summary);
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function serializeSerahTerimaBoard(storeId: number) {
  const board = await listSerahTerimaEntries(storeId);
  const allEntries = [...board.active, ...board.recentCompleted];

  const userIds = new Set<string>();
  for (const e of allEntries) {
    userIds.add(e.createdByUserId);
    if (e.completedByUserId) userIds.add(e.completedByUserId);
  }

  const nameRows = userIds.size
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]))
    : [];
  const nameById = new Map(nameRows.map((u) => [u.id, u.name]));

  const toIso = (d: Date | null) => (d ? d.toISOString() : null);
  const serialize = (e: (typeof allEntries)[number]) => ({
    id: String(e.id),
    message: e.message,
    createdByUserId: e.createdByUserId,
    createdByName: nameById.get(e.createdByUserId) ?? e.createdByUserId,
    createdAt: toIso(e.createdAt),
    isCompleted: e.isCompleted,
    completedByUserId: e.completedByUserId,
    completedByName: e.completedByUserId ? (nameById.get(e.completedByUserId) ?? e.completedByUserId) : null,
    completedAt: toIso(e.completedAt),
  });

  return {
    active: board.active.map(serialize),
    recentCompleted: board.recentCompleted.map(serialize),
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
    toDateKey(todayInStoreTimezone());

  const dateParsed = parseDate(rawDate);

  if (!dateParsed.ok) {
    return NextResponse.json(
      { success: false, error: dateParsed.error },
      { status: 400 },
    );
  }

  const rawStoreId = req.nextUrl.searchParams.get('storeId');

  // ── Detail mode: one store ────────────────────────────────────────────────
  if (rawStoreId) {
    const storeParsed = parseStoreId(rawStoreId);

    if (!storeParsed.ok) {
      return NextResponse.json(
        { success: false, error: storeParsed.error },
        { status: 400 },
      );
    }

    // OPS HO passes this automatically in _helpers.ts.
    // OPS Area still must match the selected store area.
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
        areaId: stores.areaId,
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

    const [tasks, serahTerima] = await Promise.all([
      getFlatTasksForStoreDate(storeParsed.id, dateParsed.date),
      serializeSerahTerimaBoard(storeParsed.id),
    ]);

    const summary = summariseTasks(tasks);

    return NextResponse.json({
      success: true,
      mode: 'detail',
      scope: actor.isOpsHo ? 'all_areas' : 'area',
      date: rawDate,
      store: {
        id: String(storeRow.id),
        name: storeRow.name,
        address: storeRow.address,
        areaId: storeRow.areaId === null ? null : String(storeRow.areaId),
      },
      summary: withCompletionRate(summary),
      tasks: tasks.map(serializeTask),
      // Serah Terima is a rolling per-store board, not date-scoped like the
      // other tasks above — it always reflects the current board state
      // regardless of which `date` was requested.
      serahTerima,
    });
  }

  // ── Overview mode ─────────────────────────────────────────────────────────
  const overview = actor.isOpsHo
    ? await getAllTaskOverview(dateParsed.date)
    : await getAreaTaskOverview(actor.id, dateParsed.date);

  const aggregate = makeEmptyAggregate();

  for (const store of overview.stores) {
    addToAggregate(aggregate, store.summary);
  }

  return NextResponse.json({
    success: true,
    mode: 'overview',
    scope: actor.isOpsHo ? 'all_areas' : 'area',
    date: rawDate,
    area: actor.isOpsHo
      ? null
      : overview.area
        ? {
            id: String(overview.area.id),
            name: overview.area.name,
          }
        : null,
    summary: withCompletionRate(aggregate),
    stores: overview.stores.map((store) => ({
      id: String(store.id),
      name: store.name,
      address: store.address,
      areaId:
        'areaId' in store && store.areaId !== null && store.areaId !== undefined
          ? String(store.areaId)
          : null,
      areaName:
        'areaName' in store && typeof store.areaName === 'string'
          ? store.areaName
          : null,
      summary: storeSummaryFromOverviewStore(store),
    })),
  });
}
