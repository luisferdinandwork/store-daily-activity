// app/api/ops/dashboard/queues/route.ts
//
// GET /api/ops/dashboard/queues
//
// What is waiting on Ops, longest first (see lib/db/utils/ops-dashboard-queues.ts):
// petty cash to approve, unreviewed issues, transfer orders held up in each phase, and —
// for Ops HO / IT only — the stores that still need a visit this week.
//
// Scope is resolved server-side via resolveOpsScope(): Ops HO / IT see every area, Ops Area
// only their own.

import { NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getDashboardQueues } from '@/lib/db/utils/ops-dashboard-queues';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    return NextResponse.json(await getDashboardQueues(scope));
  } catch (error) {
    console.error('[GET /api/ops/dashboard/queues]', error);
    return NextResponse.json({ success: false, error: 'Daftar dashboard gagal dimuat.' }, { status: 500 });
  }
}
