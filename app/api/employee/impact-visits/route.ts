// app/api/employee/impact-visits/route.ts
//
// GET — the employee's home store's latest 3 submitted Impact Visits, latest first,
// each with its scores and how many items Ops answered "tidak".

import { NextResponse } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { listStoreImpactVisitResults } from '@/lib/db/utils/impact-visit-results';

export async function GET() {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;

  const storeId = guard.user.homeStoreId;
  if (!storeId) return NextResponse.json({ success: true, visits: [] });

  try {
    const visits = await listStoreImpactVisitResults(storeId);
    return NextResponse.json({ success: true, visits });
  } catch (err) {
    console.error('[GET /api/employee/impact-visits]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
