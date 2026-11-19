// app/api/employee/tasks/cek-bin/bins/route.ts
//
// Cek Bin · the day's bins (monthly bin round, lib/db/utils/bin-round.ts → getEmployeeBinRound).
//
// GET ?taskId=<cek_bin_tasks.id>
//   → { success: true, data: EmployeeBinRound }
//
// The task's store + Jakarta day: the 20 bins to scan in BC (made the first time somebody opens the task that day —
// only bins not checked yet this month, random, in bin-code order), each with its state from BC's scans, and the
// month so far. A store whose bin list is still being read from BC answers `state: 'preparing'`; BC being down is
// never an error here. Same access rule as ../results: own store (home, or scheduled there that day); IT any.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, cekBinTasks, schedules, stores } from '@/lib/db/schema';
import { guardApi } from '@/lib/auth/guards';
import { jakartaDateKey, jakartaDayRange } from '@/lib/day-bucket';
import { getEmployeeBinRound } from '@/lib/db/utils/bin-round';

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(req: NextRequest) {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const taskId = Number(new URL(req.url).searchParams.get('taskId'));
  if (!Number.isInteger(taskId) || taskId <= 0) return fail('taskId is required.', 400);

  try {
    const [task] = await db
      .select({
        storeId: cekBinTasks.storeId,
        date: cekBinTasks.date,
        storeNo: stores.storeNo,
        name: stores.name,
        areaId: stores.areaId,
        areaName: areas.name,
      })
      .from(cekBinTasks)
      .innerJoin(stores, eq(stores.id, cekBinTasks.storeId))
      .leftJoin(areas, eq(areas.id, stores.areaId))
      .where(eq(cekBinTasks.id, taskId))
      .limit(1);
    if (!task) return fail('Task Cek BIN tidak ditemukan.', 404);

    const day = jakartaDateKey(task.date);

    if (user.role !== 'it' && user.homeStoreId !== task.storeId) {
      const { start, end } = jakartaDayRange(day);
      const [scheduled] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(and(eq(schedules.userId, user.id), eq(schedules.storeId, task.storeId), gte(schedules.date, start), lt(schedules.date, end)))
        .limit(1);
      if (!scheduled) return fail('Forbidden', 403);
    }

    const data = await getEmployeeBinRound(
      { id: task.storeId, storeNo: task.storeNo, name: task.name, areaId: task.areaId, areaName: task.areaName ?? null },
      day,
    );
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[GET /api/employee/tasks/cek-bin/bins]', err);
    return fail('Internal server error', 500);
  }
}
