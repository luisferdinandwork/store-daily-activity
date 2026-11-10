// app/api/employee/tasks/cek-bin/results/route.ts
//
// Cek Bin · hasil scan dari Business Central, staff app.
//
// GET ?taskId=<cek_bin_tasks.id>[&refresh=1]
//   → { success: true, data: BinCheckResult }
//
// Only the WRONG results of the task's store on the task's Jakarta day (the bins
// BC has a scan for that day). The BC location is `stores.storeNo`; the BC
// credentials never leave the server (lib/bc/bin-content-check.ts). A BC problem is
// not an error here: the answer is still 200 with `data.state` = 'not_configured' /
// 'unavailable', and the page shows a friendly "data belum tersedia" instead.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { cekBinTasks, schedules, stores } from '@/lib/db/schema';
import { guardApi } from '@/lib/auth/guards';
import { jakartaDateKey, jakartaDayRange } from '@/lib/day-bucket';
import { getBinCheckResult } from '@/lib/bc/bin-content-check';

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(req: NextRequest) {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const { searchParams } = new URL(req.url);
  const taskId = Number(searchParams.get('taskId'));
  if (!Number.isInteger(taskId) || taskId <= 0) return fail('taskId is required.', 400);

  try {
    const [task] = await db
      .select({ storeId: cekBinTasks.storeId, date: cekBinTasks.date, storeNo: stores.storeNo })
      .from(cekBinTasks)
      .innerJoin(stores, eq(stores.id, cekBinTasks.storeId))
      .where(eq(cekBinTasks.id, taskId))
      .limit(1);
    if (!task) return fail('Task Cek BIN tidak ditemukan.', 404);

    const day = jakartaDateKey(task.date);

    // Own store (home, or scheduled there that day); IT may look at any store.
    if (user.role !== 'it' && user.homeStoreId !== task.storeId) {
      const { start, end } = jakartaDayRange(day);
      const [scheduled] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId, user.id),
            eq(schedules.storeId, task.storeId),
            gte(schedules.date, start),
            lt(schedules.date, end),
          ),
        )
        .limit(1);
      if (!scheduled) return fail('Forbidden', 403);
    }

    const data = await getBinCheckResult({
      location: task.storeNo,
      day,
      force: searchParams.get('refresh') === '1',
    });

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[GET /api/employee/tasks/cek-bin/results]', err);
    return fail('Internal server error', 500);
  }
}
