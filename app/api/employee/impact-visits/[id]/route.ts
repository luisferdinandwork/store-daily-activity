// app/api/employee/impact-visits/[id]/route.ts
//
// GET — one of the latest 3 submitted Impact Visits of the employee's home store, with the items
// Ops answered "tidak" (main checklist + VM checklist) and Ops's notes.

import { NextResponse } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { getStoreImpactVisitResult } from '@/lib/db/utils/impact-visit-results';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const visitId = Number(id);
  const storeId = guard.user.homeStoreId;
  if (!Number.isInteger(visitId) || visitId <= 0 || !storeId) {
    return NextResponse.json({ success: false, error: 'Visit tidak ditemukan.' }, { status: 404 });
  }

  try {
    const visit = await getStoreImpactVisitResult(storeId, visitId);
    if (!visit) {
      return NextResponse.json({ success: false, error: 'Visit tidak ditemukan.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, visit });
  } catch (err) {
    console.error('[GET /api/employee/impact-visits/[id]]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
