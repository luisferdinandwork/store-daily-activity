// app/api/ops/performance-targets/[storeId]/employees/apply-all/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/performance-targets/:storeId/employees/apply-all
//   Body: { yearMonth }
//   → put every active employee of the store on the month's target roster in
//     one go (PIC1 / PIC2 / SA from their employee type), then split the % by
//     the default allocation template for the new headcount. Employees already
//     on the roster are skipped. See addAllStoreStaffToRoster().
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { addAllStoreStaffToRoster } from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const storeId = Number((await params).storeId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const [store] = await db
    .select({ id: stores.id, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store || (scope.scope === 'area' && store.areaId !== scope.areaId)) {
    return NextResponse.json({ success: false, error: 'Store not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const yearMonth = body?.yearMonth as string | undefined;

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'yearMonth must be in YYYY-MM format.' },
      { status: 400 },
    );
  }

  const result = await addAllStoreStaffToRoster({
    storeId,
    yearMonth,
    createdBy: scope.userId,
  });

  return NextResponse.json({ success: true, ...result });
}
