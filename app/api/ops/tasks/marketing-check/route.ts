// app/api/ops/tasks/marketing-check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { marketingCheckTasks, stores, users, userRoles } from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';

type UserInfo = {
  id: string;
  name: string | null;
  nik: string | null;
} | null;

type ChecklistKey =
  | 'promoName'
  | 'promoPeriod'
  | 'promoMechanism'
  | 'randomShoeItems'
  | 'randomNonShoeItems'
  | 'sellTag';

const CHECKLIST_FIELDS: Array<{
  key: ChecklistKey;
  label: string;
  actorKey: string;
  timeKey: string;
}> = [
  { key: 'promoName', label: 'Nama promo', actorKey: 'promoNameBy', timeKey: 'promoNameAt' },
  { key: 'promoPeriod', label: 'Periode promo', actorKey: 'promoPeriodBy', timeKey: 'promoPeriodAt' },
  { key: 'promoMechanism', label: 'Mekanisme promo', actorKey: 'promoMechanismBy', timeKey: 'promoMechanismAt' },
  { key: 'randomShoeItems', label: 'Random 5 item sepatu', actorKey: 'randomShoeItemsBy', timeKey: 'randomShoeItemsAt' },
  { key: 'randomNonShoeItems', label: 'Random 5 item non-sepatu', actorKey: 'randomNonShoeItemsBy', timeKey: 'randomNonShoeItemsAt' },
  { key: 'sellTag', label: 'Sell tag', actorKey: 'sellTagBy', timeKey: 'sellTagAt' },
];

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parsePeriod(value: string | null): Period {
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function parseDate(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseStoreId(value: string | null): number | null {
  if (!value || value === 'all') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRange(period: Period, date: Date): { start: Date; end: Date } {
  const base = startOfDay(date);

  if (period === 'monthly') {
    return {
      start: new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }

  if (period === 'weekly') {
    const day = base.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = startOfDay(addDays(base, diffToMonday));
    return { start, end: endOfDay(addDays(start, 6)) };
  }

  return { start: startOfDay(base), end: endOfDay(base) };
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function isCompletedStatus(status: string): boolean {
  return status === 'completed';
}

function toUser(user: { id: string; name: string | null; nik: string | null } | undefined | null): UserInfo {
  return user ? { id: user.id, name: user.name, nik: user.nik } : null;
}

function calculateProgress(task: Record<string, unknown>, userById: Map<string, { id: string; name: string | null; nik: string | null }>) {
  const checklist = CHECKLIST_FIELDS.map((field) => {
    const actorId = typeof task[field.actorKey] === 'string' ? task[field.actorKey] as string : null;
    const actedAt = task[field.timeKey] instanceof Date ? task[field.timeKey] as Date : null;

    return {
      key: field.key,
      label: field.label,
      done: task[field.key] === true,
      checkedBy: actorId ? toUser(userById.get(actorId)) : null,
      checkedAt: toIso(actedAt),
    };
  });

  const completedFields = checklist.filter((item) => item.done).length;
  const totalFields = checklist.length;

  return {
    checklist,
    completedFields,
    totalFields,
    progress: totalFields ? Math.round((completedFields / totalFields) * 100) : 0,
  };
}

async function getCurrentUser(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      areaId: users.areaId,
      roleCode: userRoles.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

async function getAllowedStores(roleCode: string, areaId: number | null) {
  const base = db
    .select({
      id: stores.id,
      name: stores.name,
      areaId: stores.areaId,
    })
    .from(stores);

  const rows = roleCode === 'admin'
    ? await base.orderBy(stores.name)
    : areaId
      ? await base.where(eq(stores.areaId, areaId)).orderBy(stores.name)
      : [];

  return rows.map((store) => ({
    id: String(store.id),
    name: store.name,
    areaId: store.areaId ?? null,
  }));
}

function collectUserIds(tasks: Array<Record<string, unknown>>, rows: Array<{ assignedUserId: string | null }>): string[] {
  const ids = new Set<string>();

  for (const row of rows) {
    if (row.assignedUserId) ids.add(row.assignedUserId);
  }

  for (const task of tasks) {
    const directKeys = ['completedBy', 'notesBy'];

    for (const key of directKeys) {
      const value = task[key];
      if (typeof value === 'string') ids.add(value);
    }

    for (const field of CHECKLIST_FIELDS) {
      const value = task[field.actorKey];
      if (typeof value === 'string') ids.add(value);
    }
  }

  return [...ids];
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = await getCurrentUser(session.user.id);
    const roleCode = currentUser?.roleCode ?? session.user.role;

    if (roleCode !== 'admin' && roleCode !== 'ops') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = parsePeriod(searchParams.get('period'));
    const date = parseDate(searchParams.get('date'));
    const selectedStoreId = parseStoreId(searchParams.get('storeId'));
    const { start, end } = getRange(period, date);

    const availableStores = await getAllowedStores(roleCode, currentUser?.areaId ?? null);
    const allowedStoreIds = availableStores.map((store) => Number(store.id));

    if (roleCode === 'ops' && allowedStoreIds.length === 0) {
      return NextResponse.json({
        success: true,
        period,
        date: date.toISOString().slice(0, 10),
        selectedStoreId: selectedStoreId ? String(selectedStoreId) : 'all',
        availableStores,
        summary: { stores: 0, totalTasks: 0, completedTasks: 0, averageProgress: 0 },
        stores: [],
      });
    }

    if (selectedStoreId && roleCode === 'ops' && !allowedStoreIds.includes(selectedStoreId)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: this store is outside your OPS area.' },
        { status: 403 },
      );
    }

    const filters = [
      gte(marketingCheckTasks.date, start),
      lte(marketingCheckTasks.date, end),
    ];

    if (selectedStoreId) {
      filters.push(eq(marketingCheckTasks.storeId, selectedStoreId));
    } else if (roleCode === 'ops') {
      filters.push(inArray(marketingCheckTasks.storeId, allowedStoreIds));
    }

    const rows = await db
      .select({
        task: marketingCheckTasks,
        storeId: stores.id,
        storeName: stores.name,
        storeAreaId: stores.areaId,
        assignedUserId: users.id,
        assignedUserName: users.name,
        assignedUserNik: users.nik,
      })
      .from(marketingCheckTasks)
      .innerJoin(stores, eq(marketingCheckTasks.storeId, stores.id))
      .leftJoin(users, eq(marketingCheckTasks.userId, users.id))
      .where(and(...filters))
      .orderBy(stores.name, desc(marketingCheckTasks.date));

    const rawTasks = rows.map((row) => row.task as unknown as Record<string, unknown>);
    const userIds = collectUserIds(rawTasks, rows);

    const actorRows = userIds.length
      ? await db
          .select({ id: users.id, name: users.name, nik: users.nik })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];

    const userById = new Map(actorRows.map((user) => [user.id, user]));
    const storeMap = new Map<number, any>();

    for (const row of rows) {
      const task = row.task as any;
      const progress = calculateProgress(task, userById);
      const completedBy = task.completedBy ? toUser(userById.get(task.completedBy)) : null;
      const assignedUser = row.assignedUserId
        ? { id: row.assignedUserId, name: row.assignedUserName, nik: row.assignedUserNik }
        : null;

      const activeEmployee = completedBy
        ?? progress.checklist.find((item) => item.checkedBy)?.checkedBy
        ?? assignedUser;

      const monitorTask = {
        id: String(task.id),
        scheduleId: String(task.scheduleId),
        date: toIso(task.date),
        status: task.status,
        notes: task.notes,
        completedAt: toIso(task.completedAt),
        progress: progress.progress,
        completedFields: progress.completedFields,
        totalFields: progress.totalFields,
        checklist: progress.checklist,
        assignedUser,
        employee: activeEmployee,
        completedBy,
        notesBy: task.notesBy ? toUser(userById.get(task.notesBy)) : null,
        notesAt: toIso(task.notesAt),
      };

      const storeGroup = storeMap.get(row.storeId) ?? {
        storeId: String(row.storeId),
        storeName: row.storeName,
        areaId: row.storeAreaId ?? null,
        total: 0,
        completed: 0,
        averageProgress: 0,
        tasks: [],
      };

      storeGroup.total += 1;
      if (isCompletedStatus(task.status)) storeGroup.completed += 1;
      storeGroup.tasks.push(monitorTask);

      storeMap.set(row.storeId, storeGroup);
    }

    const storeGroups = [...storeMap.values()].map((store) => {
      const totalProgress = store.tasks.reduce((sum: number, task: { progress: number }) => sum + task.progress, 0);
      return {
        ...store,
        averageProgress: store.tasks.length ? Math.round(totalProgress / store.tasks.length) : 0,
      };
    });

    const totalTasks = storeGroups.reduce((sum, store) => sum + store.total, 0);
    const totalProgress = storeGroups.reduce(
      (sum, store) => sum + store.tasks.reduce((taskSum: number, task: { progress: number }) => taskSum + task.progress, 0),
      0,
    );
    const completedTasks = storeGroups.reduce((sum, store) => sum + store.completed, 0);

    return NextResponse.json({
      success: true,
      period,
      date: date.toISOString().slice(0, 10),
      selectedStoreId: selectedStoreId ? String(selectedStoreId) : 'all',
      availableStores,
      summary: {
        stores: storeGroups.length,
        totalTasks,
        completedTasks,
        averageProgress: totalTasks ? Math.round(totalProgress / totalTasks) : 0,
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
      stores: storeGroups,
    });
  } catch (error) {
    console.error('GET /api/ops/tasks/marketing-check failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load marketing check tasks.' },
      { status: 500 },
    );
  }
}
