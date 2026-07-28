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
  schedules,
  stores,
  userStoreAssignments,
  users,
} from '@/lib/db/schema/core';
import { employeeTypes, userRoles } from '@/lib/db/schema/lookups';

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
  attendanceStatus: 'present' | 'late' | 'absent' | 'off' | 'not_scheduled' | string;
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

/** Inclusive today range in local server time */
function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { start, end };
}

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
      SELECT store_id, status FROM serah_terima_tasks   WHERE date >= ${start} AND date < ${end} AND store_id IN (${idList})
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

  // 5. Today's attendance — present count per store
  const presentRows = await db
    .select({
      storeId: attendance.storeId,
      count: sql<number>`count(*)::int`,
    })
    .from(attendance)
    .where(
      and(
        inArray(attendance.storeId, storeIds),
        gte(attendance.date, start),
        lt(attendance.date, end),
        eq(attendance.status, 'present'),
      ),
    )
    .groupBy(attendance.storeId);

  const presentByStore = new Map(presentRows.map((r) => [r.storeId, r.count]));

  // 6. Scheduled headcount per store (from daily schedules)
  const scheduledRows = await db
    .select({
      storeId: schedules.storeId,
      count: sql<number>`count(*)::int`,
    })
    .from(schedules)
    .where(
      and(
        inArray(schedules.storeId, storeIds),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ),
    )
    .groupBy(schedules.storeId);

  const scheduledByStore = new Map(scheduledRows.map((r) => [r.storeId, r.count]));

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

  // 8. Today's per-employee attendance (for roster status + check-in time)
  const employeeIds = [...new Set(assignmentRows.map((r) => r.userId))];

  const empAttendanceMap = new Map<string, { status: string; checkInTime: Date | null }>();

  if (employeeIds.length > 0) {
    const empAttRows = await db
      .select({
        userId: attendance.userId,
        status: attendance.status,
        checkInTime: attendance.checkInTime,
      })
      .from(attendance)
      .where(
        and(
          inArray(attendance.userId, employeeIds),
          gte(attendance.date, start),
          lt(attendance.date, end),
        ),
      );

    for (const row of empAttRows) {
      empAttendanceMap.set(row.userId, {
        status: row.status,
        checkInTime: row.checkInTime,
      });
    }
  }

  // 9. Group employees by store
  const employeesByStore = new Map<number, EmployeeRow[]>();
  for (const storeId of storeIds) employeesByStore.set(storeId, []);

  for (const a of assignmentRows) {
    const att = empAttendanceMap.get(a.userId);
    employeesByStore.get(a.storeId)?.push({
      id: a.userId,
      name: a.name,
      nik: a.nik,
      role: a.roleLabel,
      roleCode: a.roleCode,
      employeeType: a.employeeTypeLabel ?? null,
      employeeTypeCode: a.employeeTypeCode ?? null,
      attendanceStatus: att?.status ?? 'not_scheduled',
      checkInTime: att?.checkInTime ? att.checkInTime.toISOString() : null,
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
        scheduled: scheduledByStore.get(store.id) ?? 0,
        present: presentByStore.get(store.id) ?? 0,
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
    })
    .returning();

  return NextResponse.json({ success: true, store: created });
}