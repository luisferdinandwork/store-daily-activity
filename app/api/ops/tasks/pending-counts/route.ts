// app/api/ops/tasks/pending-counts/route.ts
//
// Pending = stores that have a schedule for `date` but DO NOT have a task row
// in `completed` or `verified` status for that task type on that date.
//
// Schedule-driven so stores whose tasks haven't been materialised yet still
// count as pending.
//
// Per-shift / per-schedule grain notes:
//   - marketing_check_tasks → unique(store, date, shift)
//   - grooming_tasks        → unique(schedule)   (per scheduled employee)
// Everything else is unique(store, date).

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type Granularity = 'store_date' | 'store_date_shift' | 'schedule';

interface TaskDescriptor {
  key: string;
  table: string;
  granularity: Granularity;
}

const TASK_DESCRIPTORS: TaskDescriptor[] = [
  { key: 'store-front',         table: 'store_front_tasks',          granularity: 'store_date' },
  { key: 'store-opening',       table: 'store_opening_tasks',        granularity: 'store_date' },
  { key: 'setoran',             table: 'setoran_tasks',              granularity: 'store_date' },
  { key: 'cek-bin',             table: 'cek_bin_tasks',              granularity: 'store_date' },
  { key: 'vm-checklist',        table: 'vm_checklist_tasks',         granularity: 'store_date' },
  { key: 'marketing-check',     table: 'marketing_check_tasks',      granularity: 'store_date_shift' },
  { key: 'item-dropping',       table: 'item_dropping_tasks',        granularity: 'store_date' },
  { key: 'briefing',            table: 'briefing_tasks',             granularity: 'store_date' },
  { key: 'edc-reconciliation',  table: 'edc_reconciliation_tasks',   granularity: 'store_date' },
  { key: 'eod-z-report',        table: 'eod_z_report_tasks',         granularity: 'store_date' },
  { key: 'open-statement',      table: 'open_statement_tasks',       granularity: 'store_date' },
  { key: 'grooming',            table: 'grooming_tasks',             granularity: 'schedule' },
];

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const targetDate = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0];

    const userRes = await db.execute(sql`
      SELECT area_id FROM users WHERE id = ${session.user.id}
    `);
    const userAreaId = (userRes.rows[0] as { area_id: number | null } | undefined)?.area_id ?? null;

    // Always begins with `AND` so it concats safely onto a `WHERE 1=1` anchor.
    const areaFilter = userAreaId ? sql`AND s.area_id = ${userAreaId}` : sql``;

    const selects = TASK_DESCRIPTORS.map((desc) => buildPendingSelect(desc, targetDate, areaFilter));
    const unionQuery = sql.join(selects, sql` UNION ALL `);
    const wrapped = sql`SELECT task_key, count FROM (${unionQuery}) AS pending`;

    const results = await db.execute(wrapped);

    const counts: Record<string, number> = {};
    for (const desc of TASK_DESCRIPTORS) counts[desc.key] = 0;
    for (const row of results.rows as { task_key: string; count: string | number }[]) {
      counts[row.task_key] = Number(row.count);
    }

    return NextResponse.json(
      { counts, date: targetDate },
      { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  } catch (error) {
    console.error('[PendingCounts] Failed to fetch:', error);
    return NextResponse.json({ counts: {}, error: String(error) }, { status: 500 });
  }
}

// ─── Per-task select builders ────────────────────────────────────────────────

function buildPendingSelect(
  desc: TaskDescriptor,
  targetDate: string,
  areaFilter: ReturnType<typeof sql>,
) {
  const taskTable = sql.identifier(desc.table);

  switch (desc.granularity) {
    case 'store_date':
      // `WHERE 1=1` is the anchor: areaFilter may be empty for super admins,
      // and starts with `AND` when present. Without the anchor, an empty
      // areaFilter would leave `WHERE AND ...` → syntax error.
      return sql`
        SELECT
          ${desc.key}::text AS task_key,
          COUNT(DISTINCT s.id) AS count
        FROM stores s
        WHERE 1=1
          ${areaFilter}
          AND EXISTS (
            SELECT 1 FROM schedules sch
            WHERE sch.store_id = s.id
              AND sch.date::date = ${targetDate}::date
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${taskTable} t
            WHERE t.store_id = s.id
              AND t.date::date = ${targetDate}::date
              AND t.status IN ('completed', 'verified')
          )
      `;

    case 'store_date_shift':
      return sql`
        SELECT
          ${desc.key}::text AS task_key,
          COUNT(DISTINCT sch.store_id) AS count
        FROM schedules sch
        JOIN stores s ON s.id = sch.store_id
        WHERE sch.date::date = ${targetDate}::date
          ${areaFilter}
          AND NOT EXISTS (
            SELECT 1 FROM ${taskTable} t
            WHERE t.store_id = sch.store_id
              AND t.date::date = sch.date::date
              AND t.shift_id = sch.shift_id
              AND t.status IN ('completed', 'verified')
          )
      `;

    case 'schedule':
      return sql`
        SELECT
          ${desc.key}::text AS task_key,
          COUNT(DISTINCT sch.store_id) AS count
        FROM schedules sch
        JOIN stores s ON s.id = sch.store_id
        WHERE sch.date::date = ${targetDate}::date
          ${areaFilter}
          AND NOT EXISTS (
            SELECT 1 FROM ${taskTable} t
            WHERE t.schedule_id = sch.id
              AND t.status IN ('completed', 'verified')
          )
      `;
  }
}