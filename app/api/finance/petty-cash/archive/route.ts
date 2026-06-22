// app/api/finance/petty-cash/archive/route.ts
//
// This should now be image cleanup only.
// It keeps transaction rows visible forever.
// It only removes imageUrl/imageKey after the image is older than 1 month.

import { NextRequest, NextResponse } from 'next/server';
import { and, inArray, isNotNull, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';
import { resolveFinanceScope } from '@/lib/finance/scope';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const hasCronToken =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (!hasCronToken) {
    const scope = await resolveFinanceScope();

    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error },
        { status: scope.status },
      );
    }
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);

  const rows = await db
    .select({
      id: pettyCashTransactions.id,
      imageKey: pettyCashTransactions.imageKey,
    })
    .from(pettyCashTransactions)
    .where(
      and(
        isNotNull(pettyCashTransactions.imageKey),
        lt(pettyCashTransactions.createdAt, cutoff),
      ),
    );

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      cleaned: 0,
      imageKeys: [],
    });
  }

  const ids = rows.map((row) => row.id);
  const imageKeys = rows
    .map((row) => row.imageKey)
    .filter(Boolean) as string[];

  await db
    .update(pettyCashTransactions)
    .set({
      imageUrl: null,
      imageKey: null,
      imageDeletedAt: new Date(),
    })
    .where(inArray(pettyCashTransactions.id, ids));

  return NextResponse.json({
    success: true,
    cleaned: ids.length,
    imageKeys,
  });
}