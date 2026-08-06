// app/api/finance/petty-cash/refill-requests/[id]/route.ts
//
// PATCH — approve or reject a refill request. Finance is the one physically
// handing over the cash, so approval tops up the store's current period
// balance immediately — this is what the employee sees as "Approved".
// Body: { action: 'approve' | 'reject', rejectionReason? }

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { approveRefillRequest, rejectRefillRequest } from '@/lib/db/utils/petty-cash-refill';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'approve') {
    const result = await approveRefillRequest(id, scope.userId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === 'reject') {
    const reason = typeof body?.rejectionReason === 'string' ? body.rejectionReason.trim() || undefined : undefined;
    const result = await rejectRefillRequest(id, scope.userId, reason);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json({ success: false, error: 'action must be "approve" or "reject".' }, { status: 400 });
}
