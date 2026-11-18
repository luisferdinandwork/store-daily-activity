// app/api/ops/petty-cash/stores/[storeId]/route.ts
//
// GET — one store for the Stores page's slide-over: its row, the requests of the period in use and the one before
// (plus anything still open from earlier) and its latest Refills. An OPS Area user only gets stores of their own
// area — any other id answers 404.

import { NextRequest, NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getOpsPettyCashStoreDetail } from '@/lib/db/utils/petty-cash-ops-stores';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ storeId: string }> }) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: raw } = await ctx.params;
  const storeId = Number(raw);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid store.' }, { status: 400 });
  }

  const detail = await getOpsPettyCashStoreDetail({ storeId, areaId: scope.areaId });
  if (!detail) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...detail });
}
