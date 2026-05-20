// app/api/ops/tasks/grooming/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  employeeTypes,
  groomingTasks,
  schedules,
  shifts,
  stores,
  userRoles,
  users,
} from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';
type Status = 'pending' | 'in_progress' | 'completed' | 'discrepancy';

type GroomingFieldKey =
  | 'uniform'
  | 'hair'
  | 'smell'
  | 'makeUp'
  | 'shoe'
  | 'nameTag'
  | 'selfie';

interface CurrentUserAccess {
  userId: string;
  roleCode: string | null;
  areaId: number | null;
}

interface GroomingField {
  key: GroomingFieldKey;
  label: string;
  active: boolean;
  done: boolean;
}

interface GroomingTaskRecord {
  id: string | null;
  scheduleId: string;
  date: string | null;
  status: Status;
  progress: number;
  completedFields: number;
  totalFields: number;
  fields: GroomingField[];
  employee: {
    id: string;
    name: string;
    nik: string | null;
    employeeType: {
      code: string | null;
      label: string | null;
    } | null;
  };
  shift: {
    id: number | null;
    code: string | null;
    label: string | null;
  } | null;
  selfiePhotos: string[];
  selfiePhotoCount: number;
  notes: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GroomingStoreRow {
  id: number;
  name: string;
  address: string | null;
  areaId: number | null;
  summary: {
    totalEmployees: number;
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    discrepancyTasks: number;
    completionRate: number;
    averageProgress: number;
    statusCount: Record<Status, number>;
  };
  tasks: GroomingTaskRecord[];
}

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

function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  return r;
}

function endOfWeek(d: Date): Date {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getRange(period: Period, date: Date): { start: Date; end: Date } {
  if (period === 'weekly') return { start: startOfWeek(date), end: endOfWeek(date) };
  if (period === 'monthly') return { start: startOfMonth(date), end: endOfMonth(date) };
  return { start: startOfDay(date), end: endOfDay(date) };
}

function parseDate(value: string | null): Date {
  if (!value) return new Date();
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function parsePeriod(value: string | null): Period {
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function statusCount(): Record<Status, number> {
  return {
    pending: 0,
    in_progress: 0,
    completed: 0,
    discrepancy: 0,
  };
}

function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

async function getCurrentUserAccess(userId: string): Promise<CurrentUserAccess | null> {
  const [row] = await db
    .select({
      userId: users.id,
      areaId: users.areaId,
      roleCode: userRoles.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

async function getAllowedStores(access: CurrentUserAccess) {
  const where = access.roleCode === 'admin'
    ? undefined
    : access.areaId
      ? eq(stores.areaId, access.areaId)
      : sql`false`;

  const query = db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      areaId: stores.areaId,
    })
    .from(stores)
    .orderBy(asc(stores.name));

  return where ? query.where(where) : query;
}

function buildGroomingFields(task: typeof groomingTasks.$inferSelect | null) {
  const selfiePhotos = parsePhotos(task?.selfiePhotos ?? null);

  const fields: GroomingField[] = [
    { key: 'uniform', label: 'Uniform', active: task?.uniformActive ?? true, done: task?.uniformChecked === true },
    { key: 'hair', label: 'Hair', active: task?.hairActive ?? true, done: task?.hairChecked === true },
    { key: 'smell', label: 'Smell', active: task?.smellActive ?? true, done: task?.smellChecked === true },
    { key: 'makeUp', label: 'Make Up', active: task?.makeUpActive ?? true, done: task?.makeUpChecked === true },
    { key: 'shoe', label: 'Shoe', active: task?.shoeActive ?? true, done: task?.shoeChecked === true },
    { key: 'nameTag', label: 'Name Tag', active: task?.nameTagActive ?? true, done: task?.nameTagChecked === true },
    { key: 'selfie', label: 'Selfie Photo', active: true, done: selfiePhotos.length > 0 },
  ];

  const activeFields = fields.filter((field) => field.active);
  const doneFields = activeFields.filter((field) => field.done);

  return {
    fields,
    completedFields: doneFields.length,
    totalFields: activeFields.length,
    progress: percent(doneFields.length, activeFields.length),
    selfiePhotos,
  };
}

function createEmptyStoreRow(store: {
  id: number;
  name: string;
  address: string | null;
  areaId: number | null;
}): GroomingStoreRow {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    areaId: store.areaId,
    summary: {
      totalEmployees: 0,
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      discrepancyTasks: 0,
      completionRate: 0,
      averageProgress: 0,
      statusCount: statusCount(),
    },
    tasks: [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getCurrentUserAccess(session.user.id);

    if (!access || (access.roleCode !== 'ops' && access.roleCode !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const period = parsePeriod(searchParams.get('period'));
    const selectedDate = parseDate(searchParams.get('date'));
    const selectedStoreIdParam = searchParams.get('storeId');
    const selectedStoreId = selectedStoreIdParam && selectedStoreIdParam !== 'all'
      ? Number(selectedStoreIdParam)
      : null;

    const { start, end } = getRange(period, selectedDate);
    const allowedStores = await getAllowedStores(access);
    const allowedStoreIds = allowedStores.map((store) => store.id);

    if (selectedStoreId && !allowedStoreIds.includes(selectedStoreId)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: this store is outside your OPS area.' },
        { status: 403 },
      );
    }

    const targetStoreIds = selectedStoreId ? [selectedStoreId] : allowedStoreIds;

    if (!targetStoreIds.length) {
      return NextResponse.json({
        success: true,
        data: {
          period,
          range: { start: start.toISOString(), end: end.toISOString() },
          availableStores: allowedStores,
          summary: {
            totalStores: 0,
            totalEmployees: 0,
            totalTasks: 0,
            completedTasks: 0,
            pendingTasks: 0,
            inProgressTasks: 0,
            discrepancyTasks: 0,
            completionRate: 0,
            averageProgress: 0,
          },
          stores: [],
        },
      });
    }

    const rows = await db
      .select({
        schedule: schedules,
        task: groomingTasks,
        employee: {
          id: users.id,
          name: users.name,
          nik: users.nik,
          employeeTypeId: users.employeeTypeId,
        },
        employeeType: {
          code: employeeTypes.code,
          label: employeeTypes.label,
        },
        store: {
          id: stores.id,
          name: stores.name,
          address: stores.address,
          areaId: stores.areaId,
        },
        shift: {
          id: shifts.id,
          code: shifts.code,
          label: shifts.label,
        },
      })
      .from(schedules)
      .innerJoin(users, eq(schedules.userId, users.id))
      .innerJoin(stores, eq(schedules.storeId, stores.id))
      .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .leftJoin(shifts, eq(schedules.shiftId, shifts.id))
      .leftJoin(groomingTasks, eq(groomingTasks.scheduleId, schedules.id))
      .where(and(
        inArray(schedules.storeId, targetStoreIds),
        eq(schedules.isHoliday, false),
        gte(schedules.date, start),
        lte(schedules.date, end),
      ))
      .orderBy(asc(stores.name), asc(schedules.date), asc(users.name));

    const storeMap = new Map<number, GroomingStoreRow>();

    for (const row of rows) {
      const store = row.store;
      const task = row.task;
      const status = (task?.status ?? 'pending') as Status;
      const progress = buildGroomingFields(task);

      const record: GroomingTaskRecord = {
        id: task ? String(task.id) : null,
        scheduleId: String(row.schedule.id),
        date: toDateKey(row.schedule.date),
        status,
        progress: progress.progress,
        completedFields: progress.completedFields,
        totalFields: progress.totalFields,
        fields: progress.fields,
        employee: {
          id: row.employee.id,
          name: row.employee.name,
          nik: row.employee.nik,
          employeeType: row.employeeType,
        },
        shift: row.shift,
        selfiePhotos: progress.selfiePhotos,
        selfiePhotoCount: progress.selfiePhotos.length,
        notes: task?.notes ?? null,
        completedAt: toIso(task?.completedAt),
        createdAt: toIso(task?.createdAt),
        updatedAt: toIso(task?.updatedAt),
      };

      let storeRow = storeMap.get(store.id);

      if (!storeRow) {
        storeRow = createEmptyStoreRow(store);
        storeMap.set(store.id, storeRow);
      }

      storeRow.tasks.push(record);
      storeRow.summary.totalTasks += 1;
      storeRow.summary.statusCount[status] += 1;

      if (status === 'completed') storeRow.summary.completedTasks += 1;
      if (status === 'pending') storeRow.summary.pendingTasks += 1;
      if (status === 'in_progress') storeRow.summary.inProgressTasks += 1;
      if (status === 'discrepancy') storeRow.summary.discrepancyTasks += 1;
    }

    const storesData = Array.from(storeMap.values()).map((store): GroomingStoreRow => {
      const uniqueEmployeeIds = new Set(store.tasks.map((task) => task.employee.id));
      const progressSum = store.tasks.reduce<number>((sum, task) => sum + Number(task.progress ?? 0), 0);

      store.summary.totalEmployees = uniqueEmployeeIds.size;
      store.summary.completionRate = percent(store.summary.completedTasks, store.summary.totalTasks);
      store.summary.averageProgress = store.summary.totalTasks
        ? Math.round(progressSum / store.summary.totalTasks)
        : 0;

      return store;
    });

    const totalTasks = storesData.reduce<number>((sum, store) => sum + Number(store.summary.totalTasks ?? 0), 0);
    const totalProgress = storesData.reduce<number>((sum, store) => {
      return sum + Number(store.summary.averageProgress ?? 0) * Number(store.summary.totalTasks ?? 0);
    }, 0);
    const completedTaskCount = storesData.reduce<number>((sum, store) => sum + Number(store.summary.completedTasks ?? 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        period,
        range: { start: start.toISOString(), end: end.toISOString() },
        availableStores: allowedStores,
        summary: {
          totalStores: storesData.length,
          totalEmployees: storesData.reduce<number>((sum, store) => sum + Number(store.summary.totalEmployees ?? 0), 0),
          totalTasks,
          completedTasks: completedTaskCount,
          pendingTasks: storesData.reduce<number>((sum, store) => sum + Number(store.summary.pendingTasks ?? 0), 0),
          inProgressTasks: storesData.reduce<number>((sum, store) => sum + Number(store.summary.inProgressTasks ?? 0), 0),
          discrepancyTasks: storesData.reduce<number>((sum, store) => sum + Number(store.summary.discrepancyTasks ?? 0), 0),
          completionRate: percent(completedTaskCount, totalTasks),
          averageProgress: totalTasks ? Math.round(totalProgress / totalTasks) : 0,
        },
        stores: storesData,
      },
    });
  } catch (error) {
    console.error('GET /api/ops/tasks/grooming failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load grooming tasks.' },
      { status: 500 },
    );
  }
}
