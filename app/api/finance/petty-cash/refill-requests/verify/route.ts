// app/api/finance/petty-cash/refill-requests/verify/route.ts
//
// POST { ids: number[], action?: 'verify' | 'unverify' }
//
// Finance marks OPS-approved refill requests as refilled ("verified") — that is
// what unlocks PIC 1's proof-of-receipt upload on the employee petty cash page.
// 'unverify' takes it back, but only while PIC 1 hasn't uploaded any photo yet.
// Requests that can't change (wrong status, already in that state) are skipped
// rather than failing the batch.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { unverifyRefillRequests, verifyRefillRequests } from '@/lib/db/utils/petty-cash-refill';

const MAX_BATCH = 200;

export async function POST(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    const body = await req.json().catch(() => null);
    const raw: unknown = body?.ids;
    const ids = Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is number => Number.isInteger(id) && id > 0))]
      : [];
    const action = body?.action === 'unverify' ? 'unverify' : 'verify';

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Pilih minimal satu Refill.' }, { status: 400 });
    }
    if (ids.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Maksimal ${MAX_BATCH} Refill sekali proses.` },
        { status: 400 },
      );
    }

    const result =
      action === 'verify'
        ? await verifyRefillRequests(ids, scope.userId)
        : await unverifyRefillRequests(ids);

    return NextResponse.json({
      success: true,
      action,
      changed: result.changedIds.length,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[POST /api/finance/petty-cash/refill-requests/verify]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
