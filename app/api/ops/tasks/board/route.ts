// app/api/ops/tasks/board/route.ts
//
// GET /api/ops/tasks/board?date=YYYY-MM-DD
//
// The Ops Task Progress board: every active store in scope × every task on one
// day (+ each store's open Serah Terima items). OPS HO / IT see every area, OPS
// Area their own. Read-only — see lib/db/utils/task-progress.ts.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema';
import { isDayKey, jakartaTodayKey } from '@/lib/day-bucket';
import { getTaskBoard } from '@/lib/db/utils/task-progress';
import { getOpsActor } from '../_helpers';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const actor = await getOpsActor(session.user.id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  const date = req.nextUrl.searchParams.get('date') ?? jakartaTodayKey();
  if (!isDayKey(date)) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }

  try {
    if (actor.isOpsHo) {
      const board = await getTaskBoard(date);
      return NextResponse.json({ success: true, date, scope: 'all_areas', areaName: null, stores: board });
    }

    if (!actor.areaId) {
      return NextResponse.json({ success: true, date, scope: 'area', areaName: null, stores: [] });
    }
    const [areaRows, storeRows] = await Promise.all([
      db.select({ name: areas.name }).from(areas).where(eq(areas.id, actor.areaId)).limit(1),
      db.select({ id: stores.id }).from(stores).where(eq(stores.areaId, actor.areaId)),
    ]);
    const board = await getTaskBoard(date, storeRows.map((s) => s.id));
    return NextResponse.json({ success: true, date, scope: 'area', areaName: areaRows[0]?.name ?? null, stores: board });
  } catch (error) {
    console.error('[GET /api/ops/tasks/board]', error);
    return NextResponse.json({ success: false, error: 'Failed to load task board.' }, { status: 500 });
  }
}
