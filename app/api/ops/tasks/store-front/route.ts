// app/api/ops/tasks/store-front/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  stores,
  storeFrontTasks,
  users,
  userRoles,
  shifts,
} from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'discrepancy';

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  discrepancy: 2,
  completed: 3,
};

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeekMonday(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeekMonday(date: Date): Date {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getRange(period: Period, anchor: Date) {
  if (period === 'weekly') return { start: startOfWeekMonday(anchor), end: endOfWeekMonday(anchor) };
  if (period === 'monthly') return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  return { start: startOfDay(anchor), end: endOfDay(anchor) };
}

function toDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function parseJsonPhotos(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function statusCount(rows: Array<{ status: string | null }>) {
  return rows.reduce<Record<TaskStatus | 'unknown', number>>(
    (acc, row) => {
      const raw = row.status ?? 'unknown';
      const key = ['pending', 'in_progress', 'completed', 'discrepancy'].includes(raw)
        ? (raw as TaskStatus)
        : 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {
      pending: 0,
      in_progress: 0,
      completed: 0,
      discrepancy: 0,
      unknown: 0,
    },
  );
}

async function getActor(userId: string) {
  const [actor] = await db
    .select({
      id: users.id,
      name: users.name,
      areaId: users.areaId,
      roleCode: userRoles.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  return actor ?? null;
}

type UserMapValue = { id: string; name: string | null; nik: string | null };

async function getUsersByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, UserMapValue>();

  const rows = await db
    .select({ id: users.id, name: users.name, nik: users.nik })
    .from(users)
    .where(inArray(users.id, uniqueIds));

  return new Map(rows.map((user) => [user.id, user]));
}

function userInfo(user: UserMapValue | undefined | null, fallbackId?: string | null) {
  if (user) return { id: user.id, name: user.name, nik: user.nik };
  return fallbackId ? { id: fallbackId, name: 'Unknown employee', nik: null } : null;
}

function pickTaskActor(
  task: {
    completedBy: string | null;
    claimedBy: string | null;
    assignedUserId: string;
  },
  userMap: Map<string, UserMapValue>,
) {
  const id = task.completedBy ?? task.claimedBy ?? task.assignedUserId ?? null;
  const source = task.completedBy
    ? 'completedBy'
    : task.claimedBy
      ? 'claimedBy'
      : 'assignedUserId';
  const user = id ? userMap.get(id) : null;

  return {
    source,
    id,
    name: user?.name ?? (id ? 'Unknown employee' : null),
    nik: user?.nik ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const actor = await getActor(session.user.id);

    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    const canView = actor.roleCode === 'ops' || actor.roleCode === 'admin';

    if (!canView) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const rawPeriod = searchParams.get('period') as Period | null;
    const period: Period =
      rawPeriod === 'weekly' || rawPeriod === 'monthly' ? rawPeriod : 'daily';
    const anchor = parseDateParam(searchParams.get('date'));
    const { start, end } = getRange(period, anchor);
    const storeIdParam = searchParams.get('storeId');
    const storeId =
      storeIdParam && storeIdParam !== 'all' ? Number(storeIdParam) : null;

    const storeFilters = [];

    if (actor.roleCode === 'ops') {
      if (!actor.areaId) {
        return NextResponse.json({
          success: true,
          data: {
            period,
            range: { start: start.toISOString(), end: end.toISOString() },
            stores: [],
            summary: {
              totalStores: 0,
              totalTasks: 0,
              completedTasks: 0,
              pendingTasks: 0,
              inProgressTasks: 0,
              discrepancyTasks: 0,
              completionRate: 0,
            },
          },
        });
      }

      storeFilters.push(eq(stores.areaId, actor.areaId));
    }

    if (storeId && Number.isFinite(storeId)) storeFilters.push(eq(stores.id, storeId));

    const storeRows = await db
      .select({
        id: stores.id,
        name: stores.name,
        address: stores.address,
        areaId: stores.areaId,
      })
      .from(stores)
      .where(storeFilters.length ? and(...storeFilters) : undefined)
      .orderBy(asc(stores.name));

    const storeIds = storeRows.map((store) => store.id);

    if (!storeIds.length) {
      return NextResponse.json({
        success: true,
        data: {
          period,
          range: { start: start.toISOString(), end: end.toISOString() },
          stores: [],
          summary: {
            totalStores: 0,
            totalTasks: 0,
            completedTasks: 0,
            pendingTasks: 0,
            inProgressTasks: 0,
            discrepancyTasks: 0,
            completionRate: 0,
          },
        },
      });
    }

    const taskRows = await db
      .select({
        id: storeFrontTasks.id,
        scheduleId: storeFrontTasks.scheduleId,
        assignedUserId: storeFrontTasks.userId,
        claimedBy: storeFrontTasks.claimedBy,
        claimedAt: storeFrontTasks.claimedAt,
        completedBy: storeFrontTasks.completedBy,
        completedByScheduleId: storeFrontTasks.completedByScheduleId,
        storeId: storeFrontTasks.storeId,
        shiftId: storeFrontTasks.shiftId,
        shiftCode: shifts.code,
        shiftLabel: shifts.label,
        date: storeFrontTasks.date,
        storefrontPhotos: storeFrontTasks.storefrontPhotos,
        rollingDoorClosedPhoto: storeFrontTasks.rollingDoorClosedPhoto,
        status: storeFrontTasks.status,
        notes: storeFrontTasks.notes,
        completedAt: storeFrontTasks.completedAt,
        createdAt: storeFrontTasks.createdAt,
        updatedAt: storeFrontTasks.updatedAt,
      })
      .from(storeFrontTasks)
      .leftJoin(shifts, eq(storeFrontTasks.shiftId, shifts.id))
      .where(
        and(
          inArray(storeFrontTasks.storeId, storeIds),
          gte(storeFrontTasks.date, start),
          lte(storeFrontTasks.date, end),
        ),
      )
      .orderBy(desc(storeFrontTasks.date), asc(storeFrontTasks.storeId));

    const userMap = await getUsersByIds(
      taskRows.flatMap(
        (task) =>
          [task.assignedUserId, task.claimedBy, task.completedBy].filter(Boolean) as string[],
      ),
    );

    const tasksByStoreId = new Map<number, typeof taskRows>();

    for (const task of taskRows) {
      const bucket = tasksByStoreId.get(task.storeId) ?? [];
      bucket.push(task);
      tasksByStoreId.set(task.storeId, bucket);
    }

    const storesWithTasks = storeRows.map((store) => {
      const rows = (tasksByStoreId.get(store.id) ?? []).sort((a, b) => {
        const statusDiff =
          (STATUS_ORDER[a.status ?? ''] ?? 99) -
          (STATUS_ORDER[b.status ?? ''] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      const completedCount = rows.filter((r) => r.status === 'completed').length;
      const pendingCount = rows.filter((r) => r.status === 'pending').length;
      const inProgressCount = rows.filter((r) => r.status === 'in_progress').length;
      const discrepancyCount = rows.filter((r) => r.status === 'discrepancy').length;

      return {
        id: store.id,
        name: store.name,
        address: store.address,
        areaId: store.areaId,
        summary: {
          totalTasks: rows.length,
          completedTasks: completedCount,
          pendingTasks: pendingCount,
          inProgressTasks: inProgressCount,
          discrepancyTasks: discrepancyCount,
          completionRate: pct(completedCount, rows.length),
          statusCount: statusCount(rows),
        },
        tasks: rows.map((task) => {
          const storefrontPhotos = parseJsonPhotos(task.storefrontPhotos);
          const employee = pickTaskActor(task, userMap);
          const assignedUser = userInfo(userMap.get(task.assignedUserId), task.assignedUserId);
          const claimedUser = userInfo(task.claimedBy ? userMap.get(task.claimedBy) : null, task.claimedBy);
          const completedUser = userInfo(task.completedBy ? userMap.get(task.completedBy) : null, task.completedBy);

          return {
            id: String(task.id),
            scheduleId: String(task.scheduleId),
            date: toDateKey(task.date),
            status: task.status,
            employee,
            assignedUser,
            claimedBy: task.claimedBy,
            claimedAt: task.claimedAt?.toISOString() ?? null,
            claimedUser,
            completedBy: task.completedBy,
            completedByScheduleId: task.completedByScheduleId
              ? String(task.completedByScheduleId)
              : null,
            completedUser,
            shift: {
              id: task.shiftId,
              code: task.shiftCode,
              label: task.shiftLabel,
            },
            storefrontPhotos,
            storefrontPhotoCount: storefrontPhotos.length,
            rollingDoorClosedPhoto: task.rollingDoorClosedPhoto,
            hasRollingDoorPhoto: Boolean(task.rollingDoorClosedPhoto),
            notes: task.notes,
            completedAt: task.completedAt?.toISOString() ?? null,
            createdAt: task.createdAt?.toISOString() ?? null,
            updatedAt: task.updatedAt?.toISOString() ?? null,
          };
        }),
      };
    });

    const completedTasks = taskRows.filter((r) => r.status === 'completed').length;
    const pendingTasks = taskRows.filter((r) => r.status === 'pending').length;
    const inProgressTasks = taskRows.filter((r) => r.status === 'in_progress').length;
    const discrepancyTasks = taskRows.filter((r) => r.status === 'discrepancy').length;

    return NextResponse.json({
      success: true,
      data: {
        period,
        range: { start: start.toISOString(), end: end.toISOString() },
        stores: storesWithTasks,
        summary: {
          totalStores: storeRows.length,
          totalTasks: taskRows.length,
          completedTasks,
          pendingTasks,
          inProgressTasks,
          discrepancyTasks,
          completionRate: pct(completedTasks, taskRows.length),
        },
      },
    });
  } catch (error) {
    console.error('GET /api/ops/tasks/store-front failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load store front tasks.' },
      { status: 500 },
    );
  }
}
