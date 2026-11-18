// app/api/ops/petty-cash/stores/route.ts
//
// GET — every store in the caller's scope with where its petty cash stands right now (period in use, cash PIC 1
// can spend, used this period, what is open, the Refill) for Ops · Petty Cash · Stores. Read-only. Scoped:
// ops_area sees only their area's stores, ops_ho / IT see all (resolveOpsScope).

import { NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { PETTY_CASH_MAX_BALANCE } from '@/lib/db/schema/petty-cash';
import { getOpsPettyCashStores } from '@/lib/db/utils/petty-cash-ops-stores';
import { jakartaTodayKey } from '@/lib/day-bucket';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const today = jakartaTodayKey();
  const rows = await getOpsPettyCashStores({ areaId: scope.areaId, today });

  return NextResponse.json({
    success: true,
    scope: scope.scope,
    today,
    maxBalance: PETTY_CASH_MAX_BALANCE,
    stores: rows,
  });
}
