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
  userRoles,
} from '@/lib/db/schema';

type Period = 'daily' | 'weekly' | 'monthly';
type Status = 'pending' | 'in_progress' | 'completed' | 'discrepancy';

type Actor = { id: string; name: string | null; nik: string | null } | null;

type FieldKey =
  | 'loginPos'
  | 'checkAbsenSunfish'
  | 'tarikSohSales'
  | 'fiveR'
  | 'fiveRAreaKasir'
  | 'fiveRAreaDepan'
  | 'fiveRAreaKanan'
  | 'fiveRAreaKiri'
  | 'fiveRAreaGudang'
  | 'cekLamp'
  | 'cekSoundSystem'
  | 'cashDrawer';

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

function getRange(period: Period, dateInput: string | null) {
  const base = dateInput ? new Date(`${dateInput}T00:00:00`) : new Date();

  if (period === 'monthly') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (period === 'weekly') return { start: startOfWeek(base), end: endOfWeek(base) };
  return { start: startOfDay(base), end: endOfDay(base) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function taskStatusFromProgress(rawStatus: Status, done: number, total: number): Status {
  if (rawStatus === 'completed' || rawStatus === 'discrepancy') return rawStatus;
  if (done > 0 && done < total) return 'in_progress';
  if (done >= total && total > 0) return 'completed';
  return rawStatus;
}

const FIELD_LABELS: Record<FieldKey, string> = {
  loginPos: 'Login POS',
  checkAbsenSunfish: 'Cek Absen Sunfish',
  tarikSohSales: 'Tarik SOH & Sales',
  fiveR: '5R Checklist',
  fiveRAreaKasir: '5R Area Kasir',
  fiveRAreaDepan: '5R Depan Toko',
  fiveRAreaKanan: '5R Sisi Kanan',
  fiveRAreaKiri: '5R Sisi Kiri',
  fiveRAreaGudang: '5R Gudang',
  cekLamp: 'Cek Lampu',
  cekSoundSystem: 'Cek Sound System',
  cashDrawer: 'Foto Meja Kasir',
};

function buildSummary() {
  return {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    discrepancy: 0,
    completionRate: 0,
    completedFields: 0,
    totalFields: 0,
  };
}

function countStatus(summary: ReturnType<typeof buildSummary>, status: Status) {
  summary.total += 1;
  if (status === 'pending') summary.pending += 1;
  else if (status === 'in_progress') summary.inProgress += 1;
  else if (status === 'completed') summary.completed += 1;
  else if (status === 'discrepancy') summary.discrepancy += 1;
}

async function getCurrentOpsUser(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      nik: users.nik,
      areaId: users.areaId,
      roleCode: userRoles.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

async function getActorMap(userIds: string[]) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Map<string, NonNullable<Actor>>();

  const rows = await db
    .select({ id: users.id, name: users.name, nik: users.nik })
    .from(users)
    .where(inArray(users.id, unique));

  return new Map(rows.map((u) => [u.id, u]));
}

function actorFrom(map: Map<string, NonNullable<Actor>>, id: string | null | undefined): Actor {
  if (!id) return null;
  return map.get(id) ?? { id, name: null, nik: null };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = await getCurrentOpsUser(session.user.id);
    if (!currentUser) return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });

    const isAdmin = currentUser.roleCode === 'admin';
    const isOps = currentUser.roleCode === 'ops';

    if (!isAdmin && !isOps) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = (searchParams.get('period') ?? 'daily') as Period;
    const date = searchParams.get('date');
    const storeIdParam = searchParams.get('storeId') ?? 'all';
    const selectedStoreId = storeIdParam && storeIdParam !== 'all' ? Number(storeIdParam) : null;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return NextResponse.json({ success: false, error: 'Invalid period.' }, { status: 400 });
    }

    if (selectedStoreId !== null && !Number.isFinite(selectedStoreId)) {
      return NextResponse.json({ success: false, error: 'Invalid storeId.' }, { status: 400 });
    }

    const { start, end } = getRange(period, date);

    if (isOps && !currentUser.areaId) {
      const emptySummary = {
        totalStores: 0,
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        discrepancyTasks: 0,
        completedFields: 0,
        totalFields: 0,
        completionRate: 0,
      };

      return NextResponse.json({
        success: true,
        range: { start: isoDate(start), end: isoDate(end) },
        stores: [],
        data: { period, range: { start: isoDate(start), end: isoDate(end) }, summary: emptySummary, stores: [] },
      });
    }

    const storeConditions = [];
    if (isOps) storeConditions.push(eq(stores.areaId, currentUser.areaId!));
    if (selectedStoreId !== null) storeConditions.push(eq(stores.id, selectedStoreId));

    const visibleStores = await db
      .select({
        id: stores.id,
        name: stores.name,
        address: stores.address,
        areaId: stores.areaId,
      })
      .from(stores)
      .where(storeConditions.length ? and(...storeConditions) : undefined)
      .orderBy(asc(stores.name));

    if (selectedStoreId !== null && visibleStores.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Store not found or outside your OPS area.' },
        { status: isOps ? 403 : 404 },
      );
    }

    const visibleStoreIds = visibleStores.map((s) => s.id);

    if (!visibleStoreIds.length) {
      const emptySummary = {
        totalStores: 0,
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        discrepancyTasks: 0,
        completedFields: 0,
        totalFields: 0,
        completionRate: 0,
      };

      return NextResponse.json({
        success: true,
        range: { start: isoDate(start), end: isoDate(end) },
        stores: [],
        data: { period, range: { start: isoDate(start), end: isoDate(end) }, summary: emptySummary, stores: [] },
      });
    }

    const taskRows = await db
      .select()
      .from(storeOpeningTasks)
      .where(and(
        inArray(storeOpeningTasks.storeId, visibleStoreIds),
        gte(storeOpeningTasks.date, start),
        lte(storeOpeningTasks.date, end),
      ));

    const actorIds: string[] = [];
    for (const t of taskRows as any[]) {
      actorIds.push(
        t.userId,
        t.completedBy,
        t.loginPosBy,
        t.checkAbsenSunfishBy,
        t.tarikSohSalesBy,
        t.fiveRBy,
        t.fiveRAreaKasirBy,
        t.fiveRAreaDepanBy,
        t.fiveRAreaKananBy,
        t.fiveRAreaKiriBy,
        t.fiveRAreaGudangBy,
        t.cekLampBy,
        t.cekSoundSystemBy,
        t.cashDrawerBy,
      );
    }

    const actorMap = await getActorMap(actorIds);

    const groups = visibleStores.map((store) => {
      const rows = (taskRows as any[]).filter((t) => Number(t.storeId) === Number(store.id));
      const summary = buildSummary();

      const tasks = rows.map((t) => {
        const photos = {
          fiveRAreaKasir: parsePhotos(t.fiveRAreaKasirPhotos),
          fiveRAreaDepan: parsePhotos(t.fiveRAreaDepanPhotos),
          fiveRAreaKanan: parsePhotos(t.fiveRAreaKananPhotos),
          fiveRAreaKiri: parsePhotos(t.fiveRAreaKiriPhotos),
          fiveRAreaGudang: parsePhotos(t.fiveRAreaGudangPhotos),
          cashDrawer: parsePhotos(t.cashDrawerPhotos),
        };

        const fields: Record<FieldKey, { label: string; done: boolean; actor: Actor; at: string | null; photoCount?: number }> = {
          loginPos: { label: FIELD_LABELS.loginPos, done: Boolean(t.loginPos), actor: actorFrom(actorMap, t.loginPosBy), at: toIso(t.loginPosAt) },
          checkAbsenSunfish: { label: FIELD_LABELS.checkAbsenSunfish, done: Boolean(t.checkAbsenSunfish), actor: actorFrom(actorMap, t.checkAbsenSunfishBy), at: toIso(t.checkAbsenSunfishAt) },
          tarikSohSales: { label: FIELD_LABELS.tarikSohSales, done: Boolean(t.tarikSohSales), actor: actorFrom(actorMap, t.tarikSohSalesBy), at: toIso(t.tarikSohSalesAt) },
          fiveR: { label: FIELD_LABELS.fiveR, done: Boolean(t.fiveR), actor: actorFrom(actorMap, t.fiveRBy), at: toIso(t.fiveRAt) },
          fiveRAreaKasir: { label: FIELD_LABELS.fiveRAreaKasir, done: photos.fiveRAreaKasir.length > 0, actor: actorFrom(actorMap, t.fiveRAreaKasirBy), at: toIso(t.fiveRAreaKasirAt), photoCount: photos.fiveRAreaKasir.length },
          fiveRAreaDepan: { label: FIELD_LABELS.fiveRAreaDepan, done: photos.fiveRAreaDepan.length > 0, actor: actorFrom(actorMap, t.fiveRAreaDepanBy), at: toIso(t.fiveRAreaDepanAt), photoCount: photos.fiveRAreaDepan.length },
          fiveRAreaKanan: { label: FIELD_LABELS.fiveRAreaKanan, done: photos.fiveRAreaKanan.length > 0, actor: actorFrom(actorMap, t.fiveRAreaKananBy), at: toIso(t.fiveRAreaKananAt), photoCount: photos.fiveRAreaKanan.length },
          fiveRAreaKiri: { label: FIELD_LABELS.fiveRAreaKiri, done: photos.fiveRAreaKiri.length > 0, actor: actorFrom(actorMap, t.fiveRAreaKiriBy), at: toIso(t.fiveRAreaKiriAt), photoCount: photos.fiveRAreaKiri.length },
          fiveRAreaGudang: { label: FIELD_LABELS.fiveRAreaGudang, done: photos.fiveRAreaGudang.length > 0, actor: actorFrom(actorMap, t.fiveRAreaGudangBy), at: toIso(t.fiveRAreaGudangAt), photoCount: photos.fiveRAreaGudang.length },
          cekLamp: { label: FIELD_LABELS.cekLamp, done: Boolean(t.cekLamp), actor: actorFrom(actorMap, t.cekLampBy), at: toIso(t.cekLampAt) },
          cekSoundSystem: { label: FIELD_LABELS.cekSoundSystem, done: Boolean(t.cekSoundSystem), actor: actorFrom(actorMap, t.cekSoundSystemBy), at: toIso(t.cekSoundSystemAt) },
          cashDrawer: { label: FIELD_LABELS.cashDrawer, done: photos.cashDrawer.length > 0, actor: actorFrom(actorMap, t.cashDrawerBy), at: toIso(t.cashDrawerAt), photoCount: photos.cashDrawer.length },
        };

        const fieldList = Object.values(fields);
        const completedFields = fieldList.filter((f) => f.done).length;
        const totalFields = fieldList.length;
        const progress = totalFields ? Math.round((completedFields / totalFields) * 100) : 0;
        const effectiveStatus = taskStatusFromProgress(t.status as Status, completedFields, totalFields);

        summary.completedFields += completedFields;
        summary.totalFields += totalFields;
        countStatus(summary, effectiveStatus);

        return {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          date: toIso(t.date),
          status: effectiveStatus,
          rawStatus: t.status,
          progress,
          completedFields,
          totalFields,
          assignedUser: actorFrom(actorMap, t.userId),
          completedBy: actorFrom(actorMap, t.completedBy),
          completedAt: toIso(t.completedAt),
          notes: t.notes,
          checklist: {
            loginPos: Boolean(t.loginPos),
            checkAbsenSunfish: Boolean(t.checkAbsenSunfish),
            tarikSohSales: Boolean(t.tarikSohSales),
            fiveR: Boolean(t.fiveR),
            cekLamp: Boolean(t.cekLamp),
            cekSoundSystem: Boolean(t.cekSoundSystem),
          },
          photos,
          fields,
        };
      });

      summary.completionRate = summary.totalFields
        ? Math.round((summary.completedFields / summary.totalFields) * 100)
        : 0;

      return {
        store: {
          id: String(store.id),
          name: store.name,
          address: store.address,
          areaId: store.areaId,
        },
        summary,
        tasks,
      };
    });

    const globalSummary = groups.reduce(
      (acc, group) => {
        acc.totalStores += 1;
        acc.totalTasks += group.summary.total;
        acc.completedTasks += group.summary.completed;
        acc.pendingTasks += group.summary.pending;
        acc.inProgressTasks += group.summary.inProgress;
        acc.discrepancyTasks += group.summary.discrepancy;
        acc.completedFields += group.summary.completedFields;
        acc.totalFields += group.summary.totalFields;
        return acc;
      },
      {
        totalStores: 0,
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        discrepancyTasks: 0,
        completedFields: 0,
        totalFields: 0,
        completionRate: 0,
      },
    );

    globalSummary.completionRate = globalSummary.totalFields
      ? Math.round((globalSummary.completedFields / globalSummary.totalFields) * 100)
      : 0;

    return NextResponse.json({
      success: true,
      range: { start: isoDate(start), end: isoDate(end) },
      stores: groups,
      data: {
        period,
        range: { start: isoDate(start), end: isoDate(end) },
        summary: globalSummary,
        stores: groups,
      },
    });
  } catch (error) {
    console.error('GET /api/ops/tasks/store-opening failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load store opening tasks.' },
      { status: 500 },
    );
  }
}
