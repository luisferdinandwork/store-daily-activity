// app/api/ops/tasks/store-opening/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  storeOpeningTasks,
  stores,
  users,
} from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function parseDateKey(value: string | null): Date {
  if (!value) return new Date();
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function getRange(period: Period, date: Date) {
  const base = startOfDay(date);

  if (period === 'weekly') {
    const start = new Date(base);
    const day = start.getDay(); // Sunday = 0
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);

    const end = endOfDay(start);
    end.setDate(start.getDate() + 6);

    return { start, end };
  }

  if (period === 'monthly') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  return { start: startOfDay(base), end: endOfDay(base) };
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeStatus(status: string | null | undefined) {
  return status ?? 'pending';
}

function emptySummary() {
  return {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    verified: 0,
    rejected: 0,
  };
}

function addStatus(summary: ReturnType<typeof emptySummary>, status: string) {
  summary.total += 1;

  switch (status) {
    case 'in_progress':
      summary.inProgress += 1;
      break;
    case 'completed':
      summary.completed += 1;
      break;
    case 'verified':
      summary.verified += 1;
      break;
    case 'rejected':
      summary.rejected += 1;
      break;
    default:
      summary.pending += 1;
      break;
  }
}

type Actor = {
  id: string;
  name: string | null;
  email: string | null;
} | null;

function actorFromMap(
  map: Map<string, { id: string; name: string | null; email: string | null }>,
  id: string | null | undefined,
): Actor {
  if (!id) return null;
  return map.get(id) ?? { id, name: null, email: null };
}

function collectActorIds(row: typeof storeOpeningTasks.$inferSelect): string[] {
  return [
    row.userId,
    row.loginPosBy,
    row.checkAbsenSunfishBy,
    row.tarikSohSalesBy,
    row.fiveRBy,
    row.fiveRAreaKasirBy,
    row.fiveRAreaDepanBy,
    row.fiveRAreaKananBy,
    row.fiveRAreaKiriBy,
    row.fiveRAreaGudangBy,
    row.cekLampBy,
    row.cekSoundSystemBy,
    row.cashDrawerBy,
    row.completedBy,
    row.verifiedBy,
  ].filter((v): v is string => Boolean(v));
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const role = (session.user as any).role as string | undefined;

    if (role !== 'ops' && role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);

    const periodParam = searchParams.get('period') as Period | null;
    const period: Period =
      periodParam === 'weekly' || periodParam === 'monthly' || periodParam === 'daily'
        ? periodParam
        : 'daily';

    const selectedStoreId = searchParams.get('storeId') ?? 'all';
    const targetDate = parseDateKey(searchParams.get('date'));
    const range = getRange(period, targetDate);

    const [currentUser] = await db
      .select({
        id: users.id,
        areaId: users.areaId,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'User not found.' },
        { status: 404 },
      );
    }

    const storeWhere =
      role === 'admin'
        ? undefined
        : currentUser.areaId
          ? eq(stores.areaId, currentUser.areaId)
          : undefined;

    if (role === 'ops' && !currentUser.areaId) {
      return NextResponse.json({
        success: true,
        range: {
          start: toDateKey(range.start),
          end: toDateKey(range.end),
        },
        stores: [],
      });
    }

    const visibleStores = storeWhere
      ? await db
          .select({
            id: stores.id,
            name: stores.name,
            address: stores.address,
            areaId: stores.areaId,
          })
          .from(stores)
          .where(storeWhere)
          .orderBy(asc(stores.name))
      : await db
          .select({
            id: stores.id,
            name: stores.name,
            address: stores.address,
            areaId: stores.areaId,
          })
          .from(stores)
          .orderBy(asc(stores.name));

    const visibleStoreIds = visibleStores.map((s) => s.id);

    if (!visibleStoreIds.length) {
      return NextResponse.json({
        success: true,
        range: {
          start: toDateKey(range.start),
          end: toDateKey(range.end),
        },
        stores: [],
      });
    }

    let storeIdsToQuery = visibleStoreIds;

    if (selectedStoreId !== 'all') {
      const parsedStoreId = Number(selectedStoreId);

      if (!Number.isFinite(parsedStoreId)) {
        return NextResponse.json(
          { success: false, error: 'Invalid storeId.' },
          { status: 400 },
        );
      }

      if (!visibleStoreIds.includes(parsedStoreId)) {
        return NextResponse.json(
          { success: false, error: 'This store is not in your area.' },
          { status: 403 },
        );
      }

      storeIdsToQuery = [parsedStoreId];
    }

    const storesToReturn = visibleStores.filter((s) => storeIdsToQuery.includes(s.id));

    const taskRows = await db
      .select()
      .from(storeOpeningTasks)
      .where(
        and(
          inArray(storeOpeningTasks.storeId, storeIdsToQuery),
          gte(storeOpeningTasks.date, range.start),
          lte(storeOpeningTasks.date, range.end),
        ),
      )
      .orderBy(asc(storeOpeningTasks.date));

    const actorIds = [...new Set(taskRows.flatMap(collectActorIds))];

    const actorRows = actorIds.length
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];

    const actorMap = new Map(actorRows.map((u) => [u.id, u]));

    const tasksByStore = new Map<number, typeof taskRows>();

    for (const task of taskRows) {
      const bucket = tasksByStore.get(task.storeId) ?? [];
      bucket.push(task);
      tasksByStore.set(task.storeId, bucket);
    }

    const resultStores = storesToReturn.map((store) => {
      const tasks = tasksByStore.get(store.id) ?? [];
      const summary = emptySummary();

      const mappedTasks = tasks.map((task) => {
        const status = normalizeStatus(task.status);
        addStatus(summary, status);

        return {
          id: String(task.id),
          date: toDateKey(task.date),
          status,
          assignedUser: actorFromMap(actorMap, task.userId),
          completedBy: actorFromMap(actorMap, task.completedBy),
          completedAt: toIso(task.completedAt),
          notes: task.notes,

          checklist: {
            loginPos: task.loginPos,
            checkAbsenSunfish: task.checkAbsenSunfish,
            tarikSohSales: task.tarikSohSales,
            fiveR: task.fiveR,
            cekLamp: task.cekLamp,
            cekSoundSystem: task.cekSoundSystem,
          },

          photos: {
            fiveRAreaKasir: parsePhotos(task.fiveRAreaKasirPhotos),
            fiveRAreaDepan: parsePhotos(task.fiveRAreaDepanPhotos),
            fiveRAreaKanan: parsePhotos(task.fiveRAreaKananPhotos),
            fiveRAreaKiri: parsePhotos(task.fiveRAreaKiriPhotos),
            fiveRAreaGudang: parsePhotos(task.fiveRAreaGudangPhotos),
            cashDrawer: parsePhotos(task.cashDrawerPhotos),
          },

          fieldActors: {
            loginPos: {
              by: actorFromMap(actorMap, task.loginPosBy),
              at: toIso(task.loginPosAt),
            },
            checkAbsenSunfish: {
              by: actorFromMap(actorMap, task.checkAbsenSunfishBy),
              at: toIso(task.checkAbsenSunfishAt),
            },
            tarikSohSales: {
              by: actorFromMap(actorMap, task.tarikSohSalesBy),
              at: toIso(task.tarikSohSalesAt),
            },
            fiveR: {
              by: actorFromMap(actorMap, task.fiveRBy),
              at: toIso(task.fiveRAt),
            },
            fiveRAreaKasir: {
              by: actorFromMap(actorMap, task.fiveRAreaKasirBy),
              at: toIso(task.fiveRAreaKasirAt),
            },
            fiveRAreaDepan: {
              by: actorFromMap(actorMap, task.fiveRAreaDepanBy),
              at: toIso(task.fiveRAreaDepanAt),
            },
            fiveRAreaKanan: {
              by: actorFromMap(actorMap, task.fiveRAreaKananBy),
              at: toIso(task.fiveRAreaKananAt),
            },
            fiveRAreaKiri: {
              by: actorFromMap(actorMap, task.fiveRAreaKiriBy),
              at: toIso(task.fiveRAreaKiriAt),
            },
            fiveRAreaGudang: {
              by: actorFromMap(actorMap, task.fiveRAreaGudangBy),
              at: toIso(task.fiveRAreaGudangAt),
            },
            cekLamp: {
              by: actorFromMap(actorMap, task.cekLampBy),
              at: toIso(task.cekLampAt),
            },
            cekSoundSystem: {
              by: actorFromMap(actorMap, task.cekSoundSystemBy),
              at: toIso(task.cekSoundSystemAt),
            },
            cashDrawer: {
              by: actorFromMap(actorMap, task.cashDrawerBy),
              at: toIso(task.cashDrawerAt),
            },
          },
        };
      });

      return {
        store: {
          id: String(store.id),
          name: store.name,
          address: store.address,
        },
        summary,
        tasks: mappedTasks,
      };
    });

    return NextResponse.json({
      success: true,
      range: {
        start: toDateKey(range.start),
        end: toDateKey(range.end),
      },
      stores: resultStores,
    });
  } catch (err) {
    console.error('[GET /api/ops/tasks/store-opening]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load Store Opening monitor.' },
      { status: 500 },
    );
  }
}
