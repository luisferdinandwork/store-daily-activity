// app/api/finance/petty-cash/transactions/[txId]/review/route.ts
//
// POST { action: 'reject' | 'accept', comment?: string }
//
// Finance's review of one completed petty cash request (rules: lib/petty-cash-review.ts):
//   reject — turn it down, with or without a comment; PIC 1 is notified and may correct it
//   accept — accept PIC 1's correction, or take a rejection back
// Both stop once the store's refill has been verified.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { financeAcceptTransaction, financeRejectTransaction } from '@/lib/db/utils/petty-cash-review';

type Params = { params: Promise<{ txId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const txId = Number((await params).txId);
  if (!Number.isInteger(txId) || txId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid txId.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'reject' && action !== 'accept') {
    return NextResponse.json({ success: false, error: 'action must be "reject" or "accept".' }, { status: 400 });
  }

  try {
    const result =
      action === 'reject'
        ? await financeRejectTransaction({ txId, actorId: scope.userId, comment: body?.comment })
        : await financeAcceptTransaction({ txId, actorId: scope.userId });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/finance/petty-cash/transactions/[txId]/review]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
