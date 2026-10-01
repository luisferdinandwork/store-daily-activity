// app/api/ops/stores/route.ts
//
// Returns areas → stores with per-store:
//   - task completion stats for today (across all 10 task tables)
//   - attendance summary for today
//   - employee roster with individual attendance status
//
// Scoping (via resolveOpsScope):
//   ops_ho   → all areas
//   ops_area → their assigned areaId only

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { resolveItScope } from '@/lib/auth/it-scope';
import {
  areas,
  attendance,
  monthlyScheduleEntries,
  schedules,
  stores,
  storeStatusHistory,
  userStoreAssignments,
  users,
} from '@/lib/db/schema/core';
import { employeeTypes, shifts, userRoles } from '@/lib/db/schema/lookups';
import { jakartaDayRange, jakartaTodayKey, jakartaWallClock } from '@/lib/day-bucket';
import { isStoreStatus, type StoreStatus } from '@/lib/store-status';

// ─── Public types (consumed by the page) ─────────────────────────────────────

export type TaskColorStatus = 'green' | 'yellow' | 'red' | 'gray';

export type EmployeeRow = {
  id: string;
  name: string;
  nik: string;
  role: string;
  roleCode: string;
  employeeType: string | null;
  employeeTypeCode: string | null;
  /**
   * Today's roster state. Recorded attendance statuses (present / late /
   * absent / excused / dinas / cuti / sakit_*) pass through; the rest are
   * derived from the schedule:
   *   upcoming        scheduled, shift hasn't started yet
   *   not_checked_in  scheduled, shift started, no check-in recorded
   *   off | leave     scheduled day off / leave on the monthly schedule
   *   not_scheduled   no schedule for today at all
   *   not_recording   store isn't `active` (prep / closed)
   */
  attendanceStatus: string;
  checkInTime: string | null;
};

export type StoreRow = {
  id: number;
  storeNo: string;
  name: string;
  address: string;
  areaId: number;
  latitude: string | null;
  longitude: string | null;
  geofenceRadiusM: string | null;
  pettyCashBalance: string;
  /** Lifecycle — see lib/store-status.ts. */
  status: StoreStatus;
  closedAt: string | null;
  /** BC department dimension code. Only present for IT (back-office reference, hidden from Ops). */
  deptCode?: string | null;
  taskStats: {
    total: number;
    completed: number;
    notStarted: number;
    inProgress: number;
    pending: number;
    completionRate: number;
    colorStatus: TaskColorStatus;
  };
  attendanceSummary: {
    scheduled: number;
    present: number;
  };
  employees: EmployeeRow[];
};

export type AreaGroup = {
  id: number;
  name: string;
  stores: StoreRow[];
};

export type StoresApiResponse =
  | { success: true; data: AreaGroup[] }
  | { success: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** [start, end) of today's Asia/Jakarta day — matches both stored day-bucket encodings. */
function todayRange() {
  return jakartaDayRange(jakartaTodayKey());
}

/** Checked-in statuses — someone who showed up (late still counts as present). */
const ATTENDED_STATUSES = new Set(['present', 'late']);

function toColorStatus(rate: number, total: number): TaskColorStatus {
  if (total === 0) return 'gray';
  if (rate >= 80) return 'green';
  if (rate >= 50) return 'yellow';
  return 'red';
}

// ─── Task aggregation ─────────────────────────────────────────────────────────
//
// All task tables share the same shape for the columns we need:
//   storeId  integer  → stores.id
//   date     timestamp
//   status   taskStatusEnum  (not_started | in_progress | completed | pending | …)
//
// We UNION-ALL all 11 task tables using Drizzle's sql`` template literal so
// parameters are bound correctly by the Neon HTTP driver.
// The result is accessed via .rows (NeonHttpQueryResult shape).

type TaskStatRow = {
  storeId: number;
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
};

async function fetchTaskStats(
  storeIds: number[],
  start: Date,
  end: Date,
): Promise<Map<number, TaskStatRow>> {
  if (storeIds.length === 0) return new Map();

  // sql`` interpolates each expression as a bound parameter automatically.
  // sql.join builds a comma-separated list of bound values for the IN clause.
  const idList = sql.join(storeIds.map((id) => sql`${id}`), sql`, `);

  const result = await db.execute<{
    store_id: number;
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
  }>(sql`
    WITH all_tasks AS (
      SELECT store_id, status FROM store_opening_tasks  WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM store_front_tasks    WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM setoran_tasks        WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM cek_bin_tasks        WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM vm_checklist_tasks   WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM item_dropping_tasks  WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM marketing_check_tasks WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM briefing_tasks       WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM store_closing_tasks  WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
      UNION ALL
      SELECT store_id, status FROM grooming_tasks       WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
    )
    SELECT
      store_id,
      COUNT(*)::int                                             AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int        AS completed,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int      AS in_progress,
      COUNT(*) FILTER (WHERE status = 'pending')::int          AS pending
    FROM all_tasks
    GROUP BY store_id
  `);

  // Neon's HTTP driver returns { rows: [...] }; websocket driver is directly
  // iterable. Access .rows when present, fall back to the result itself.
  const rows: { store_id: number; total: number; completed: number; in_progress: number; pending: number }[] =
    Array.isArray((result as { rows?: unknown[] }).rows)
      ? (result as { rows: typeof rows }).rows
      : (result as unknown as typeof rows);

  const map = new Map<number, TaskStatRow>();
  for (const row of rows) {
    map.set(Number(row.store_id), {
      storeId:    Number(row.store_id),
      total:      Number(row.total),
      completed:  Number(row.completed),
      inProgress: Number(row.in_progress),
      pending:    Number(row.pending),
    });
  }
  return map;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse<StoresApiResponse>> {
  // 1. Auth + scope
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const { start, end } = todayRange();
  const isIt = (await resolveItScope()).ok;

  // 2. Load areas (filtered for ops_area)
  const allAreas = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .orderBy(areas.name);

  const visibleAreas =
    scope.scope === 'area'
      ? allAreas.filter((a) => a.id === scope.areaId)
      : allAreas;

  if (visibleAreas.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const areaIds = visibleAreas.map((a) => a.id);

  // 3. Load stores
  const storeRows = await db
    .select()
    .from(stores)
    .where(inArray(stores.areaId, areaIds))
    .orderBy(stores.name);

  if (storeRows.length === 0) {
    // Still return the visible areas (even with no stores yet) so the
    // management UI can offer "add a store" for an empty area.
    const emptyAreas: AreaGroup[] = visibleAreas.map((a) => ({ id: a.id, name: a.name, stores: [] }));
    return NextResponse.json({ success: true, data: emptyAreas });
  }

  const storeIds = storeRows.map((s) => s.id);

  // 4. Task stats (UNION ALL across all task tables)
  const taskStatsMap = await fetchTaskStats(storeIds, start, end);

  // 5. Today's schedule + attendance. One row per scheduled shift, joined to
  //    its attendance record (if the employee has checked in / Ops recorded
  //    leave). This drives both the store's present/scheduled counter and each
  //    roster row, so the two can't disagree.
  const todayRows = await db
    .select({
      scheduleId: schedules.id,
      storeId: schedules.storeId,
      userId: schedules.userId,
      shiftStart: shifts.startTime,
      status: attendance.status,
      checkInTime: attendance.checkInTime,
    })
    .from(schedules)
    .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
    .leftJoin(attendance, eq(attendance.scheduleId, schedules.id))
    .where(
      and(
        inArray(schedules.storeId, storeIds),
        eq(schedules.isHoliday, false),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ),
    );

  const todayKey = jakartaTodayKey();
  const nowMs = Date.now();

  const scheduledByStore = new Map<number, number>();
  const presentByStore = new Map<number, number>();
  // storeId:userId → best row (an attendance record beats a bare schedule)
  const todayByEmployee = new Map<string, { status: string; checkInTime: Date | null }>();

  for (const r of todayRows) {
    scheduledByStore.set(r.storeId, (scheduledByStore.get(r.storeId) ?? 0) + 1);
    if (r.status && ATTENDED_STATUSES.has(r.status)) {
      presentByStore.set(r.storeId, (presentByStore.get(r.storeId) ?? 0) + 1);
    }

    const key = `${r.storeId}:${r.userId}`;
    if (r.status) {
      const prev = todayByEmployee.get(key);
      // Keep a checked-in status over a leave/absent one if a user somehow
      // has two shifts today.
      if (!prev || !ATTENDED_STATUSES.has(prev.status)) {
        todayByEmployee.set(key, { status: r.status, checkInTime: r.checkInTime });
      }
    } else if (!todayByEmployee.has(key)) {
      const started = !r.shiftStart || jakartaWallClock(todayKey, r.shiftStart).getTime() <= nowMs;
      todayByEmployee.set(key, { status: started ? 'not_checked_in' : 'upcoming', checkInTime: null });
    }
  }

  // 7. Active employee assignments for visible stores
  const assignmentRows = await db
    .select({
      userId: userStoreAssignments.userId,
      storeId: userStoreAssignments.storeId,
      name: users.name,
      nik: users.nik,
      roleLabel: userRoles.label,
      roleCode: userRoles.code,
      employeeTypeLabel: employeeTypes.label,
      employeeTypeCode: employeeTypes.code,
    })
    .from(userStoreAssignments)
    .innerJoin(users, eq(userStoreAssignments.userId, users.id))
    .innerJoin(userRoles, eq(userStoreAssignments.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(
      and(
        inArray(userStoreAssignments.storeId, storeIds),
        eq(userStoreAssignments.isActive, true),
        eq(users.isActive, true),
      ),
    )
    .orderBy(users.name);

  // 8. Employees with no shift today: tell a planned day off / leave apart from
  //    "not on the schedule at all" (monthly schedule keeps OFF & leave days).
  const employeeIds = [...new Set(assignmentRows.map((r) => r.userId))];
  const dayOffByUser = new Map<string, 'off' | 'leave'>();

  if (employeeIds.length > 0) {
    const offRows = await db
      .select({
        userId: monthlyScheduleEntries.userId,
        isOff: monthlyScheduleEntries.isOff,
        isLeave: monthlyScheduleEntries.isLeave,
      })
      .from(monthlyScheduleEntries)
      .where(
        and(
          inArray(monthlyScheduleEntries.userId, employeeIds),
          gte(monthlyScheduleEntries.date, start),
          lt(monthlyScheduleEntries.date, end),
        ),
      );

    for (const row of offRows) {
      if (row.isLeave) dayOffByUser.set(row.userId, 'leave');
      else if (row.isOff && !dayOffByUser.has(row.userId)) dayOffByUser.set(row.userId, 'off');
    }
  }

  const storeIsActive = new Map(storeRows.map((s) => [s.id, s.status === 'active']));

  // 9. Group employees by store
  const employeesByStore = new Map<number, EmployeeRow[]>();
  for (const storeId of storeIds) employeesByStore.set(storeId, []);

  for (const a of assignmentRows) {
    const att = storeIsActive.get(a.storeId)
      ? todayByEmployee.get(`${a.storeId}:${a.userId}`) ?? {
          status: dayOffByUser.get(a.userId) ?? 'not_scheduled',
          checkInTime: null,
        }
      : { status: 'not_recording', checkInTime: null };
    employeesByStore.get(a.storeId)?.push({
      id: a.userId,
      name: a.name,
      nik: a.nik,
      role: a.roleLabel,
      roleCode: a.roleCode,
      employeeType: a.employeeTypeLabel ?? null,
      employeeTypeCode: a.employeeTypeCode ?? null,
      attendanceStatus: att.status,
      checkInTime: att.checkInTime ? att.checkInTime.toISOString() : null,
    });
  }

  // 10. Assemble area → store → employee tree
  const areaMap = new Map<number, AreaGroup>(
    visibleAreas.map((a) => [a.id, { id: a.id, name: a.name, stores: [] }]),
  );

  for (const store of storeRows) {
    const ts = taskStatsMap.get(store.id) ?? {
      storeId: store.id,
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
    };
    const notStarted = ts.total - ts.completed - ts.inProgress - ts.pending;
    const rate = ts.total > 0 ? Math.round((ts.completed / ts.total) * 100) : 0;

    const storeRow: StoreRow = {
      id: store.id,
      storeNo: store.storeNo,
      name: store.name,
      address: store.address,
      areaId: store.areaId,
      latitude: store.latitude,
      longitude: store.longitude,
      geofenceRadiusM: store.geofenceRadiusM,
      pettyCashBalance: store.pettyCashBalance ?? '0',
      status: store.status,
      closedAt: store.closedAt ? store.closedAt.toISOString() : null,
      ...(isIt ? { deptCode: store.deptCode } : {}),
      taskStats: {
        total: ts.total,
        completed: ts.completed,
        notStarted: Math.max(0, notStarted),
        inProgress: ts.inProgress,
        pending: ts.pending,
        completionRate: rate,
        colorStatus: toColorStatus(rate, ts.total),
      },
      attendanceSummary: {
        // A prep/closed store's schedule isn't an attendance expectation.
        scheduled: store.status === 'active' ? scheduledByStore.get(store.id) ?? 0 : 0,
        // Checked in on time or late — late staff are present.
        present: store.status === 'active' ? presentByStore.get(store.id) ?? 0 : 0,
      },
      employees: employeesByStore.get(store.id) ?? [],
    };

    areaMap.get(store.areaId)?.stores.push(storeRow);
  }

  // Keep areas with zero stores visible too — management UI needs them to
  // offer "add a store" for an empty area.
  const result = Array.from(areaMap.values());
  return NextResponse.json({ success: true, data: result });
}

// ─── Create ───────────────────────────────────────────────────────────────────
//
// POST /api/ops/stores
//   → create a new store. OPS HO may create in any visible area; OPS Area is
//     locked to their own assigned area regardless of what areaId is sent.

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function parseCoordinate(raw: unknown, min: number, max: number): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n.toFixed(7) };
}

export async function POST(request: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);

  const storeNo = typeof body?.storeNo === 'string' ? body.storeNo.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const address = typeof body?.address === 'string' ? body.address.trim() : '';

  if (!storeNo || !name || !address) {
    return NextResponse.json(
      { success: false, error: 'storeNo, name, and address are required.' },
      { status: 400 },
    );
  }

  // OPS Area can only create stores in their own area, regardless of the
  // areaId the client sent.
  const requestedAreaId = Number(body?.areaId);
  const areaId = scope.scope === 'area' ? scope.areaId : requestedAreaId;

  if (!Number.isFinite(areaId)) {
    return NextResponse.json({ success: false, error: 'A valid areaId is required.' }, { status: 400 });
  }

  const [areaRow] = await db.select({ id: areas.id }).from(areas).where(eq(areas.id, areaId)).limit(1);
  if (!areaRow || (scope.scope === 'area' && areaId !== scope.areaId)) {
    return NextResponse.json({ success: false, error: 'Invalid area.' }, { status: 400 });
  }

  const wantsLocation =
    body?.latitude !== undefined || body?.longitude !== undefined || body?.geofenceRadiusM !== undefined;

  if (wantsLocation) {
    const itScope = await resolveItScope();
    if (!itScope.ok) {
      return NextResponse.json(
        { success: false, error: "Forbidden: only IT can set a store's location." },
        { status: 403 },
      );
    }
  }

  const lat = parseCoordinate(body?.latitude, LAT_MIN, LAT_MAX);
  const lng = parseCoordinate(body?.longitude, LNG_MIN, LNG_MAX);
  if (!lat.ok) return NextResponse.json({ success: false, error: 'Latitude must be between -90 and 90.' }, { status: 400 });
  if (!lng.ok) return NextResponse.json({ success: false, error: 'Longitude must be between -180 and 180.' }, { status: 400 });

  const radius = parseCoordinate(body?.geofenceRadiusM, 1, 100_000);
  if (!radius.ok) {
    return NextResponse.json({ success: false, error: 'Geofence radius must be a positive number.' }, { status: 400 });
  }

  const [existing] = await db.select({ id: stores.id }).from(stores).where(eq(stores.storeNo, storeNo)).limit(1);
  if (existing) {
    return NextResponse.json({ success: false, error: `A store with code "${storeNo}" already exists.` }, { status: 409 });
  }

  // New stores start in preparation (ready_to_open) unless IT says otherwise:
  // Ops/PIC can build the schedule and targets, and IT activates the store when
  // it opens. Only IT may create a store straight into another status, and
  // only IT sees / sets the BC dept code.
  const itScope = await resolveItScope();
  const isIt = itScope.ok;

  let status: StoreStatus = 'ready_to_open';
  if (body?.status !== undefined) {
    if (!isStoreStatus(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status.' }, { status: 400 });
    }
    if (!isIt && body.status !== 'ready_to_open') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: only IT can create a store in this status.' },
        { status: 403 },
      );
    }
    status = body.status;
  }

  let deptCode: string | null = null;
  if (body?.deptCode !== undefined && body.deptCode !== null && body.deptCode !== '') {
    if (!isIt) {
      return NextResponse.json({ success: false, error: 'Forbidden: only IT can set a dept code.' }, { status: 403 });
    }
    if (typeof body.deptCode !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid dept code.' }, { status: 400 });
    }
    const requested: string = body.deptCode.trim().toUpperCase();
    const [dup] = await db.select({ id: stores.id }).from(stores).where(eq(stores.deptCode, requested)).limit(1);
    if (dup) {
      return NextResponse.json({ success: false, error: `Dept code "${requested}" is already used by another store.` }, { status: 409 });
    }
    deptCode = requested;
  }

  const [created] = await db
    .insert(stores)
    .values({
      storeNo,
      name,
      address,
      areaId,
      latitude: lat.value,
      longitude: lng.value,
      ...(radius.value ? { geofenceRadiusM: radius.value } : {}),
      status,
      statusChangedAt: new Date(),
      deptCode,
      // A store that isn't live yet carries no petty cash; activation provisions it.
      ...(status === 'ready_to_open' ? { pettyCashBalance: '0' } : {}),
    })
    .returning();

  await db.insert(storeStatusHistory).values({
    storeId: created.id,
    fromStatus: null,
    toStatus: status,
    changedBy: scope.userId,
    note: 'Store created',
  });

  const { deptCode: createdDeptCode, ...publicStore } = created;
  return NextResponse.json({ success: true, store: isIt ? { ...publicStore, deptCode: createdDeptCode } : publicStore });
}