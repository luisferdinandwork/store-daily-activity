// app/api/tasks/cek-bin/results/route.ts
//
// Cek Bin · hasil scan dari Business Central, for the people who REVIEW a store's
// tasks: the task detail of Ops (modal + sheet), IT and the PIC panel all draw the
// same panel (components/employee/BinCheckResults.tsx) and ask here by store + day.
// (Staff on their own task page use ../../employee/tasks/cek-bin/results, by task id.)
//
// GET ?storeId=<stores.id>&date=YYYY-MM-DD[&refresh=1]
//   → { success: true, data: BinCheckResult }
//
// Who may ask — decided here, not by the proxy (this path is open to any signed-in role):
//   • IT                 any store
//   • OPS HO             any store;  OPS Area  only stores of their own area
//   • PIC 1 / PIC 2      only their own home store
// A BC problem is not an error: the answer is still 200 with `data.state` =
// 'not_configured' / 'unavailable' and the panel shows a calm "belum tersedia" card.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { guardApi } from '@/lib/auth/guards';
import { isDayKey } from '@/lib/day-bucket';
import { getBinCheckResult } from '@/lib/bc/bin-content-check';
import { assertStoreInActorArea, getOpsActor, parseStoreId } from '../../../ops/tasks/_helpers';

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(req: NextRequest) {
  const guard = await guardApi(['employee', 'ops', 'it']);
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const { searchParams } = new URL(req.url);
  const parsed = parseStoreId(searchParams.get('storeId'));
  if (!parsed.ok) return fail(parsed.error, 400);
  const storeId = parsed.id;

  const day = searchParams.get('date') ?? '';
  if (!isDayKey(day)) return fail('date must be YYYY-MM-DD.', 400);

  try {
    if (user.role === 'ops') {
      const actor = await getOpsActor(user.id);
      if (!actor) return fail('Forbidden', 403);
      const areaErr = await assertStoreInActorArea(actor, storeId);
      if (areaErr) return fail(areaErr, 403);
    } else if (user.role === 'employee') {
      const isPic = user.employeeType === 'pic_1' || user.employeeType === 'pic_2';
      if (!isPic || user.homeStoreId !== storeId) return fail('Forbidden', 403);
    }
    // 'it' → any store.

    const [store] = await db
      .select({ storeNo: stores.storeNo })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) return fail('Store not found.', 404);

    const data = await getBinCheckResult({
      location: store.storeNo,
      day,
      force: searchParams.get('refresh') === '1',
    });

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[GET /api/tasks/cek-bin/results]', err);
    return fail('Internal server error', 500);
  }
}
