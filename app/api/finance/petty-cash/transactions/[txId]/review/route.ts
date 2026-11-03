// app/api/finance/petty-cash/transactions/[txId]/review/route.ts
//
// POST { action: 'revise' | 'reject' | 'accept', comment?: string }
//
// Finance's review of one completed petty cash request (rules: lib/petty-cash-review.ts):
//   revise — "Perlu Perbaikan": send it back, with or without a comment; PIC 1 is notified and may correct it
//   reject — "Ditolak": turn it down for good, with or without a comment; PIC 1 files it again next month as a re-request
//   accept — accept PIC 1's correction, or take a decision back
// All of them stop once the store's refill has been verified.

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
  if (action !== 'revise' && action !== 'reject' && action !== 'accept') {
    return NextResponse.json({ success: false, error: 'action must be "revise", "reject" or "accept".' }, { status: 400 });
  }

  try {
    const result =
      action === 'accept'
        ? await financeAcceptTransaction({ txId, actorId: scope.userId })
        : await financeRejectTransaction({
            txId,
            actorId: scope.userId,
            kind: action === 'revise' ? 'needs_fix' : 'rejected',
            comment: body?.comment,
          });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/finance/petty-cash/transactions/[txId]/review]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
