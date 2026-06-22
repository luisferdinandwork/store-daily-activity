// app/api/finance/petty-cash/[storeId]/verify/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { stores } from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';

type Params = { params: Promise<{ storeId: string }> };

function getJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function POST(req: NextRequest, { params }: Params) {
  const scope = await resolveFinanceScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const { storeId: storeIdStr } = await params;
  const storeId = Number(storeIdStr);

  if (Number.isNaN(storeId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid storeId.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const yearMonth =
    typeof body?.yearMonth === 'string' && body.yearMonth.trim()
      ? body.yearMonth.trim()
      : getJakartaMonth();

  if (!isValidMonth(yearMonth)) {
    return NextResponse.json(
      { success: false, error: 'Invalid yearMonth. Use YYYY-MM.' },
      { status: 400 },
    );
  }

  const txId =
    body?.txId !== undefined && body?.txId !== null
      ? Number(body.txId)
      : null;

  if (txId !== null && Number.isNaN(txId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid txId.' },
      { status: 400 },
    );
  }

  const [storeRow] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!storeRow) {
    return NextResponse.json(
      { success: false, error: 'Store not found.' },
      { status: 404 },
    );
  }

  if (txId !== null) {
    const updated = await db
      .update(pettyCashTransactions)
      .set({
        verifiedBy: scope.userId,
        verifiedAt: new Date(),
      })
      .where(
        and(
          eq(pettyCashTransactions.id, txId),
          eq(pettyCashTransactions.storeId, storeId),
          eq(pettyCashTransactions.yearMonth, yearMonth),
          eq(pettyCashTransactions.status, 'ops_approved'),
          isNotNull(pettyCashTransactions.imageUrl),
          isNull(pettyCashTransactions.verifiedAt),
        ),
      )
      .returning({
        id: pettyCashTransactions.id,
      });

    if (updated.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Verification failed. Request must be OPS approved, have a receipt image, and not be verified yet.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      verified: updated.length,
    });
  }

  const updated = await db
    .update(pettyCashTransactions)
    .set({
      verifiedBy: scope.userId,
      verifiedAt: new Date(),
    })
    .where(
      and(
        eq(pettyCashTransactions.storeId, storeId),
        eq(pettyCashTransactions.yearMonth, yearMonth),
        eq(pettyCashTransactions.status, 'ops_approved'),
        isNotNull(pettyCashTransactions.imageUrl),
        isNull(pettyCashTransactions.verifiedAt),
      ),
    )
    .returning({
      id: pettyCashTransactions.id,
    });

  return NextResponse.json({
    success: true,
    verified: updated.length,
  });
}