// app/api/ops/tasks/setoran/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  setoranTasks,
  setoranMoneyStorage,
  stores,
  users,
  userRoles,
} from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';

type AvailableStore = {
  id: string;
  name: string;
  areaId: number | null;
};

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function getRange(period: Period, date: Date) {
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
    const end = endOfDay(addDays(start, 6));
    return { start, end };
  }

  return { start: startOfDay(base), end: endOfDay(base) };
}

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function parsePeriod(raw: string | null): Period {
  return raw === 'weekly' || raw === 'monthly' ? raw : 'daily';
}

function parseDate(raw: string | null): Date {
  if (!raw) return new Date();
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function parseStoreId(raw: string | null): number | null {
  if (!raw || raw === 'all') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function num(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isDone(status: string) {
  return status === 'completed' || status === 'verified';
}

async function getCurrentOpsUser(userId: string) {
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

async function getAllowedStores(roleCode: string, areaId: number | null): Promise<AvailableStore[]> {
  const baseSelect = db
    .select({
      id: stores.id,
      name: stores.name,
      areaId: stores.areaId,
    })
    .from(stores);

  const rows = roleCode === 'admin'
    ? await baseSelect.orderBy(stores.name)
    : areaId
      ? await baseSelect.where(eq(stores.areaId, areaId)).orderBy(stores.name)
      : [];

  return rows.map((s) => ({
    id: String(s.id),
    name: s.name,
    areaId: s.areaId ?? null,
  }));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const currentUser = await getCurrentOpsUser(session.user.id);
  const roleCode = currentUser?.roleCode ?? (session.user as any)?.role;

  if (roleCode !== 'admin' && roleCode !== 'ops') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams.get('period'));
  const date = parseDate(searchParams.get('date'));
  const selectedStoreId = parseStoreId(searchParams.get('storeId'));
  const { start, end } = getRange(period, date);

  const availableStores = await getAllowedStores(roleCode, currentUser?.areaId ?? null);
  const allowedStoreIds = availableStores.map((s) => Number(s.id));

  if (roleCode === 'ops' && allowedStoreIds.length === 0) {
    return NextResponse.json({
      success: true,
      period,
      date: date.toISOString().slice(0, 10),
      range: { start: start.toISOString(), end: end.toISOString() },
      availableStores,
      selectedStoreId: selectedStoreId ? String(selectedStoreId) : 'all',
      summary: { stores: 0, totalTasks: 0, completed: 0, verified: 0, unpaidTotal: 0 },
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
    gte(setoranTasks.date, start),
    lte(setoranTasks.date, end),
  ];

  if (selectedStoreId) {
    filters.push(eq(setoranTasks.storeId, selectedStoreId));
  } else if (roleCode === 'ops') {
    filters.push(inArray(setoranTasks.storeId, allowedStoreIds));
  }

  const taskRows = await db
    .select({
      task: setoranTasks,
      storeId: stores.id,
      storeName: stores.name,
      storeAreaId: stores.areaId,
    })
    .from(setoranTasks)
    .innerJoin(stores, eq(setoranTasks.storeId, stores.id))
    .where(and(...filters))
    .orderBy(stores.name, desc(setoranTasks.date));

  const taskIds = taskRows.map((r) => r.task.id);

  const storageRows = taskIds.length
    ? await db
        .select()
        .from(setoranMoneyStorage)
        .where(inArray(setoranMoneyStorage.taskId, taskIds))
    : [];

  const storageByTask = new Map(storageRows.map((r) => [r.taskId, r]));

  const userIds = new Set<string>();
  for (const row of taskRows) {
    const t = row.task as any;
    [
      t.userId,
      t.actualReceivedAmountBy,
      t.storedAmountBy,
      t.resiPhotoBy,
      t.atmCardSelfiePhotoBy,
      t.notesBy,
      t.completedBy,
    ].forEach((id) => { if (id) userIds.add(String(id)); });
  }

  for (const s of storageRows as any[]) {
    [
      s.userId,
      s.actualReceivedAmountBy,
      s.storedAmountBy,
      s.resiPhotoBy,
      s.atmCardSelfiePhotoBy,
      s.notesBy,
      s.completedBy,
    ].forEach((id) => { if (id) userIds.add(String(id)); });
  }

  const userRows = userIds.size
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, [...userIds]))
    : [];

  const userById = new Map(userRows.map((u) => [u.id, u]));

  function userInfo(id: string | null | undefined) {
    if (!id) return null;
    const u = userById.get(id);
    return u ? { id: u.id, name: u.name, email: u.email } : { id, name: null, email: null };
  }

  const storesMap = new Map<number, any>();

  for (const row of taskRows) {
    const t = row.task as any;
    const storage = storageByTask.get(t.id) as any | undefined;
    const source = storage ?? t;

    const actorIds = {
      actualReceivedAmountBy: t.actualReceivedAmountBy ?? storage?.actualReceivedAmountBy ?? null,
      storedAmountBy: t.storedAmountBy ?? storage?.storedAmountBy ?? null,
      resiPhotoBy: t.resiPhotoBy ?? storage?.resiPhotoBy ?? null,
      atmCardSelfiePhotoBy: t.atmCardSelfiePhotoBy ?? storage?.atmCardSelfiePhotoBy ?? null,
      notesBy: t.notesBy ?? storage?.notesBy ?? null,
      completedBy: t.completedBy ?? storage?.completedBy ?? null,
    };

    const item = {
      id: String(t.id),
      scheduleId: String(t.scheduleId),
      date: toIso(t.date),
      status: t.status,
      completedAt: toIso(t.completedAt),
      verifiedAt: toIso(t.verifiedAt),
      notes: t.notes,

      actualReceivedAmount: source.actualReceivedAmount ?? t.expectedAmount,
      previousUnpaidAmount: source.previousUnpaidAmount ?? t.carriedDeficit,
      requiredStoreAmount: source.requiredStoreAmount ?? String(num(t.expectedAmount) + num(t.carriedDeficit)),
      storedAmount: source.storedAmount ?? t.amount,
      unpaidAmount: source.unpaidAmount ?? t.unpaidAmount,
      resiPhoto: source.resiPhoto ?? t.resiPhoto,
      atmCardSelfiePhoto: source.atmCardSelfiePhoto ?? t.atmCardSelfiePhoto,

      assignedUser: userInfo(t.userId),
      completedUser: userInfo(actorIds.completedBy),
      fieldActors: {
        actualReceivedAmount: {
          user: userInfo(actorIds.actualReceivedAmountBy),
          at: toIso(t.actualReceivedAmountAt ?? storage?.actualReceivedAmountAt),
        },
        storedAmount: {
          user: userInfo(actorIds.storedAmountBy),
          at: toIso(t.storedAmountAt ?? storage?.storedAmountAt),
        },
        resiPhoto: {
          user: userInfo(actorIds.resiPhotoBy),
          at: toIso(t.resiPhotoAt ?? storage?.resiPhotoAt),
        },
        atmCardSelfiePhoto: {
          user: userInfo(actorIds.atmCardSelfiePhotoBy),
          at: toIso(t.atmCardSelfiePhotoAt ?? storage?.atmCardSelfiePhotoAt),
        },
        notes: {
          user: userInfo(actorIds.notesBy),
          at: toIso(t.notesAt ?? storage?.notesAt),
        },
      },
    };

    const bucket = storesMap.get(row.storeId) ?? {
      storeId: String(row.storeId),
      storeName: row.storeName,
      areaId: row.storeAreaId ?? null,
      total: 0,
      completed: 0,
      verified: 0,
      unpaidTotal: 0,
      tasks: [],
    };

    bucket.total += 1;
    if (t.status === 'completed') bucket.completed += 1;
    if (t.status === 'verified') bucket.verified += 1;
    bucket.unpaidTotal += num(item.unpaidAmount);
    bucket.tasks.push(item);
    storesMap.set(row.storeId, bucket);
  }

  const storesResult = [...storesMap.values()].sort((a, b) => String(a.storeName).localeCompare(String(b.storeName)));

  return NextResponse.json({
    success: true,
    period,
    date: date.toISOString().slice(0, 10),
    range: { start: start.toISOString(), end: end.toISOString() },
    selectedStoreId: selectedStoreId ? String(selectedStoreId) : 'all',
    availableStores,
    summary: {
      stores: storesResult.length,
      totalTasks: storesResult.reduce((s, x) => s + x.total, 0),
      completed: storesResult.reduce((s, x) => s + x.completed, 0),
      verified: storesResult.reduce((s, x) => s + x.verified, 0),
      unpaidTotal: storesResult.reduce((s, x) => s + x.unpaidTotal, 0),
    },
    stores: storesResult,
  });
}
