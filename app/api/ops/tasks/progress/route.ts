// app/api/ops/tasks/progress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import {
  getAllTaskOverview,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type RawFlatTask = Awaited<ReturnType<typeof getFlatTasksForStoreDate>>[number];

type TaskSummary = {
  pending: number;
  inProgress: number;
  completed: number;
  discrepancy: number;
  verified: number;
  rejected: number;
  total: number;
};

type MaybeTaskSummary = Partial<TaskSummary> & {
  total?: number;
  completed?: number;
};

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

// ─── Small helpers ────────────────────────────────────────────────────────────

function stringifyId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

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
    pending: 0,
    inProgress: 0,
    completed: 0,
    discrepancy: 0,
    verified: 0,
    rejected: 0,
    total: 0,
  };
}

function normalizeSummary(summary: MaybeTaskSummary): TaskSummary {
  return {
    pending: toNumber(summary.pending),
    inProgress: toNumber(summary.inProgress),
    completed: toNumber(summary.completed),
    discrepancy: toNumber(summary.discrepancy),
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

  aggregate.pending += normalized.pending;
  aggregate.inProgress += normalized.inProgress;
  aggregate.completed += normalized.completed;
  aggregate.discrepancy += normalized.discrepancy;
  aggregate.verified += normalized.verified;
  aggregate.rejected += normalized.rejected;
  aggregate.total += normalized.total;
}

function serializeUnknown(value: unknown): SerializableValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeUnknown);
  }

  if (typeof value === 'object') {
    const out: Record<string, SerializableValue> = {};

    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeUnknown(item);
    }

    return out;
  }

  return String(value);
}

function normalizeNestedIds(
  value: SerializableValue,
  keys: readonly string[],
): SerializableValue {
  if (!Array.isArray(value)) return value;

  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;

    const out: Record<string, SerializableValue> = { ...item };

    for (const key of keys) {
      if (key in out) out[key] = stringifyId(out[key]) ?? '';
    }

    return out;
  });
}

function serializeExtra(extra: Record<string, unknown> | null | undefined) {
  const safeExtra = (extra ?? {}) as Record<string, unknown>;
  const serialized = serializeUnknown(safeExtra) as Record<string, SerializableValue>;

  /**
   * Serah Terima uses nested handover items. Convert nested IDs to string so the
   * OPS progress page can safely render them without number/string mismatch.
   */
  if (Array.isArray(serialized.items)) {
    serialized.items = normalizeNestedIds(serialized.items, [
      'id',
      'taskId',
      'senderTaskId',
      'receiverTaskId',
    ]) as SerializableValue[];
  }

  /**
   * Item Return / Cek Uang Muka use nested rows too. Keep their IDs serialized
   * the same way as top-level task IDs for safer frontend rendering.
   */
  if (Array.isArray(serialized.entries)) {
    serialized.entries = normalizeNestedIds(serialized.entries, [
      'id',
      'taskId',
      'storeId',
    ]) as SerializableValue[];
  }

  if (Array.isArray(serialized.denominations)) {
    serialized.denominations = normalizeNestedIds(serialized.denominations, [
      'id',
      'taskId',
      'storeId',
    ]) as SerializableValue[];
  }

  return serialized;
}

function serializeTask(task: RawFlatTask) {
  return {
    ...task,
    id: String(task.id),
    scheduleId: String(task.scheduleId),
    storeId: String(task.storeId),
    parentTaskId:
      task.parentTaskId === null || task.parentTaskId === undefined
        ? null
        : Number(task.parentTaskId),
    extra: serializeExtra(task.extra),
  };
}

function storeSummaryFromOverviewStore(store: {
  summary: MaybeTaskSummary;
}) {
  return withCompletionRate(store.summary);
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

    const tasks = await getFlatTasksForStoreDate(
      storeParsed.id,
      dateParsed.date,
    );

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
