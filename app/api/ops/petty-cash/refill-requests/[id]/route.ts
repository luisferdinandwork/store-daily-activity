// app/api/ops/petty-cash/refill-requests/[id]/route.ts
//
// PATCH — OPS approves or rejects a PIC-initiated refill request. This is
// the administrative approval only: it does NOT move any balance and Finance
// is still the one who physically hands over the cash (see
// lib/db/utils/petty-cash-refill.ts for the full flow).
// Body: { action: 'approve' | 'reject', rejectionReason? }

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { stores } from '@/lib/db/schema/core';
import { pettyCashRefillRequests } from '@/lib/db/schema/petty-cash';
import { approveRefillRequest, rejectRefillRequest } from '@/lib/db/utils/petty-cash-refill';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  if (scope.scope === 'area') {
    const [row] = await db
      .select({ storeAreaId: stores.areaId })
      .from(pettyCashRefillRequests)
      .innerJoin(stores, eq(stores.id, pettyCashRefillRequests.storeId))
      .where(eq(pettyCashRefillRequests.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ success: false, error: 'Request not found.' }, { status: 404 });
    }

    if (row.storeAreaId !== scope.areaId) {
      return NextResponse.json(
        { success: false, error: 'You can only act on refill requests from your assigned area.' },
        { status: 403 },
      );
    }
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
