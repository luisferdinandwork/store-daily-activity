// app/api/finance/petty-cash/[storeId]/verify/route.ts
//
// POST  — verify one transaction (or all unverified at once)
//
// Body: { txId?: number }
//   txId present → verify that single transaction
//   txId absent  → verify ALL unverified transactions for this store/month

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';

type Params = { params: Promise<{ storeId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdStr } = await params;
  const storeId = Number(storeIdStr);
  if (isNaN(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid storeId.' }, { status: 400 });
  }

  const month = new Date().toISOString().slice(0, 7);
  const body  = await req.json().catch(() => ({}));
  const txId  = typeof body?.txId === 'number' ? body.txId : null;

  const now = new Date();

  if (txId !== null) {
    // Verify a single transaction
    await db
      .update(pettyCashTransactions)
      .set({ verifiedBy: scope.userId, verifiedAt: now })
      .where(
        and(
          eq(pettyCashTransactions.id, txId),
          eq(pettyCashTransactions.storeId, storeId),
          isNull(pettyCashTransactions.verifiedAt),
        ),
      );
  } else {
    // Verify all unverified transactions for this store this month
    await db
      .update(pettyCashTransactions)
      .set({ verifiedBy: scope.userId, verifiedAt: now })
      .where(
        and(
          eq(pettyCashTransactions.storeId, storeId),
          eq(pettyCashTransactions.yearMonth, month),
          isNull(pettyCashTransactions.verifiedAt),
          isNull(pettyCashTransactions.archivedAt),
        ),
      );
  }

  return NextResponse.json({ success: true });
}