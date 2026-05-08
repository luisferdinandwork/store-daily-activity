// app/api/ops/tasks/pending-stores/route.ts
//
// Returns the list of stores pending for ONE task type on a given date,
// each with its current state for that task:
//   pendingState:
//     'no_row'       → schedule exists but the task row hasn't been created yet
//     'pending'      → row exists with status='pending'
//     'in_progress'  → row exists with status='in_progress'
//     'rejected'     → row exists with status='rejected'
//     'discrepancy'  → row exists with status='discrepancy'

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type Granularity = 'store_date' | 'store_date_shift' | 'schedule';

const TASK_TABLE_BY_KEY: Record<string, { table: string; granularity: Granularity }> = {
  'store-front':         { table: 'store_front_tasks',          granularity: 'store_date' },
  'store-opening':       { table: 'store_opening_tasks',        granularity: 'store_date' },
  'setoran':             { table: 'setoran_tasks',              granularity: 'store_date' },
  'cek-bin':             { table: 'cek_bin_tasks',              granularity: 'store_date' },
  'vm-checklist':        { table: 'vm_checklist_tasks',         granularity: 'store_date' },
  'marketing-check':     { table: 'marketing_check_tasks',      granularity: 'store_date_shift' },
  'item-dropping':       { table: 'item_dropping_tasks',        granularity: 'store_date' },
  'briefing':            { table: 'briefing_tasks',             granularity: 'store_date' },
  'edc-reconciliation':  { table: 'edc_reconciliation_tasks',   granularity: 'store_date' },
  'eod-z-report':        { table: 'eod_z_report_tasks',         granularity: 'store_date' },
  'open-statement':      { table: 'open_statement_tasks',       granularity: 'store_date' },
  'grooming':            { table: 'grooming_tasks',             granularity: 'schedule' },
};

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const taskKey = params.get('task') ?? '';
    const targetDate = params.get('date') ?? new Date().toISOString().split('T')[0];

    const desc = TASK_TABLE_BY_KEY[taskKey];
    if (!desc) {
      return NextResponse.json({ error: `Unknown task key: ${taskKey}` }, { status: 400 });
    }

    const userRes = await db.execute(sql`SELECT area_id FROM users WHERE id = ${session.user.id}`);
    const userAreaId = (userRes.rows[0] as { area_id: number | null } | undefined)?.area_id ?? null;
    const areaFilter = userAreaId ? sql`AND s.area_id = ${userAreaId}` : sql``;

    const taskTable = sql.identifier(desc.table);

    let query;
    if (desc.granularity === 'store_date') {
      // WHERE 1=1 anchor — same fix as pending-counts. Without it, an empty
      // areaFilter would produce `WHERE EXISTS ...` followed by an unanchored
      // `AND` (or, equivalently here, would just confuse the planner).
      query = sql`
        SELECT
          s.id::text          AS store_id,
          s.name              AS store_name,
          s.address           AS store_address,
          t.id::text          AS task_id,
          t.status::text      AS task_status,
          t.completed_at      AS completed_at,
          t.updated_at        AS updated_at
        FROM stores s
        LEFT JOIN ${taskTable} t
          ON t.store_id = s.id
         AND t.date::date = ${targetDate}::date
        WHERE 1=1
          ${areaFilter}
          AND EXISTS (
            SELECT 1 FROM schedules sch
            WHERE sch.store_id = s.id
              AND sch.date::date = ${targetDate}::date
          )
          AND (t.id IS NULL OR t.status NOT IN ('completed', 'verified'))
        ORDER BY s.name ASC
      `;
    } else if (desc.granularity === 'store_date_shift') {
      query = sql`
        SELECT DISTINCT ON (s.id, sch.shift_id)
          s.id::text          AS store_id,
          s.name              AS store_name,
          s.address           AS store_address,
          t.id::text          AS task_id,
          t.status::text      AS task_status,
          t.completed_at      AS completed_at,
          t.updated_at        AS updated_at,
          sch.shift_id        AS shift_id
        FROM schedules sch
        JOIN stores s ON s.id = sch.store_id
        LEFT JOIN ${taskTable} t
          ON t.store_id = sch.store_id
         AND t.date::date = sch.date::date
         AND t.shift_id = sch.shift_id
        WHERE sch.date::date = ${targetDate}::date
          ${areaFilter}
          AND (t.id IS NULL OR t.status NOT IN ('completed', 'verified'))
        ORDER BY s.id, sch.shift_id, s.name ASC
      `;
    } else {
      query = sql`
        SELECT
          s.id::text          AS store_id,
          s.name              AS store_name,
          s.address           AS store_address,
          t.id::text          AS task_id,
          t.status::text      AS task_status,
          t.completed_at      AS completed_at,
          t.updated_at        AS updated_at,
          sch.user_id         AS user_id
        FROM schedules sch
        JOIN stores s ON s.id = sch.store_id
        LEFT JOIN ${taskTable} t ON t.schedule_id = sch.id
        WHERE sch.date::date = ${targetDate}::date
          ${areaFilter}
          AND (t.id IS NULL OR t.status NOT IN ('completed', 'verified'))
        ORDER BY s.name ASC
      `;
    }

    const result = await db.execute(query);

    const stores = (result.rows as Array<{
      store_id: string;
      store_name: string;
      store_address: string | null;
      task_id: string | null;
      task_status: string | null;
      completed_at: Date | string | null;
      updated_at: Date | string | null;
      shift_id?: number | null;
      user_id?: string | null;
    }>).map((row) => {
      const pendingState =
        row.task_id == null
          ? ('no_row' as const)
          : (row.task_status as 'pending' | 'in_progress' | 'rejected' | 'discrepancy');

      return {
        storeId:      row.store_id,
        storeName:    row.store_name,
        storeAddress: row.store_address,
        taskId:       row.task_id,
        taskStatus:   row.task_status,
        pendingState,
        completedAt:  row.completed_at ? new Date(row.completed_at).toISOString() : null,
        updatedAt:    row.updated_at   ? new Date(row.updated_at).toISOString()   : null,
        shiftId:      row.shift_id ?? null,
        userId:       row.user_id ?? null,
      };
    });

    const summary = stores.reduce(
      (acc, row) => {
        if (!acc.storeIds.has(row.storeId)) {
          acc.storeIds.add(row.storeId);
          acc.uniqueStores += 1;
        }
        acc.byState[row.pendingState] = (acc.byState[row.pendingState] ?? 0) + 1;
        return acc;
      },
      { uniqueStores: 0, storeIds: new Set<string>(), byState: {} as Record<string, number> },
    );

    return NextResponse.json(
      {
        task: taskKey,
        date: targetDate,
        rows: stores,
        summary: {
          uniqueStores: summary.uniqueStores,
          totalRows: stores.length,
          byState: summary.byState,
        },
      },
      { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  } catch (error) {
    console.error('[PendingStores] Failed to fetch:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}