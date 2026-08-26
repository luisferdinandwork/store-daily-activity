// app/api/pic/tasks/progress/range/route.ts
//
// GET /api/pic/tasks/progress/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// Weekly/monthly task-progress breakdown for PIC 1 / PIC 2 — always scoped to
// the actor's own home store, mirroring app/api/ops/tasks/progress/range but
// without any cross-store/area access.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { getStoreSummariesForRange } from '@/lib/db/utils/tasks';
import { resolveActorCodes, parseLocalDate } from '../../../schedule/_utils';

function isPicType(empType: string | null) {
  return empType === 'pic_1' || empType === 'pic_2';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  const { role, empType } = await resolveActorCodes(user.id as string);

  if (role !== 'employee' || !isPicType(empType)) {
    return NextResponse.json({ success: false, error: 'PIC only.' }, { status: 403 });
  }

  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  if (!rawHomeStoreId) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const storeId = Number(rawHomeStoreId);
  if (Number.isNaN(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const startDate = parseLocalDate(sp.get('startDate') ?? '');
  const endDate = parseLocalDate(sp.get('endDate') ?? '');

  if (!startDate) {
    return NextResponse.json({ success: false, error: 'Invalid startDate.' }, { status: 400 });
  }
  if (!endDate) {
    return NextResponse.json({ success: false, error: 'Invalid endDate.' }, { status: 400 });
  }

  const [storeRow, summaries] = await Promise.all([
    db.select({ id: stores.id, name: stores.name, address: stores.address }).from(stores)
      .where(eq(stores.id, storeId)).limit(1),
    getStoreSummariesForRange([storeId], startDate, endDate),
  ]);

  if (!storeRow[0]) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    startDate: sp.get('startDate'),
    endDate: sp.get('endDate'),
    store: { id: String(storeRow[0].id), name: storeRow[0].name, address: storeRow[0].address },
    summaries: summaries.map((s) => ({
      date: s.date,
      notStarted: s.notStarted,
      inProgress: s.inProgress,
      completed: s.completed,
      pending: s.pending,
      total: s.total,
    })),
  });
}
