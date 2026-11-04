// app/api/ops/areas/calendar/route.ts
//
// GET /api/ops/areas/calendar?month=YYYY-MM
//
// Per day of the month, every active store's attendance counts + task slots, for
// the Area Management calendar (areas are rolled up in the browser, so a store
// moved to another area shows up there straight away). OPS HO and IT only —
// Ops Area never sees other areas.

import { NextRequest, NextResponse } from 'next/server';

import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { getAreaCalendar } from '@/lib/db/utils/area-calendar';

export const dynamic = 'force-dynamic';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }
  if (scope.scope !== 'all_areas') {
    return NextResponse.json({ success: false, error: 'OPS HO access only.' }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH_KEY.test(month)) {
    return NextResponse.json({ success: false, error: 'month must be YYYY-MM' }, { status: 400 });
  }

  try {
    const data = await getAreaCalendar(month);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[GET /api/ops/areas/calendar]', err);
    return NextResponse.json({ success: false, error: 'Failed to load the area calendar.' }, { status: 500 });
  }
}
