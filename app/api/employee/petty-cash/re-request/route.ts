// app/api/employee/petty-cash/re-request/route.ts
//
// POST { txId, categoryId?, description, actualAmount, imageUrl?, imageKey? } — PIC 1 fixes a request Finance sent
// back with Perlu Perbaikan (it is a `draft`) and sends the SAME request to OPS again, marked Re-request
// (lib/db/utils/petty-cash-re-request.ts → resubmitFixedRequest). No new request is made.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/core';
import { isPettyCashHolder } from '@/lib/db/utils/petty-cash-refill';
import { resubmitFixedRequest } from '@/lib/db/utils/petty-cash-re-request';
import { assertStoreOperational } from '@/lib/db/utils/store-status';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const employeeType = (session as { user?: { employeeType?: string | null } } | null)?.user?.employeeType;
  if (!isPettyCashHolder(employeeType)) {
    return NextResponse.json({ success: false, error: 'Hanya PIC 1 yang bisa memperbaiki request petty cash.' }, { status: 403 });
  }

  const [user] = await db.select({ homeStoreId: users.homeStoreId }).from(users).where(eq(users.id, userId)).limit(1);
  const storeId = user?.homeStoreId ?? null;
  if (!storeId) return NextResponse.json({ success: false, error: 'No store assigned.' }, { status: 403 });

  const inactive = await assertStoreOperational(storeId);
  if (inactive) return NextResponse.json({ success: false, error: inactive }, { status: 403 });

  const body = await req.json().catch(() => null);
  const txId = Number(body?.txId);
  if (!Number.isInteger(txId) || txId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid txId.' }, { status: 400 });
  }

  try {
    const result = await resubmitFixedRequest({
      txId,
      storeId,
      userId,
      description: body?.description,
      actualAmount: body?.actualAmount,
      categoryId: body?.categoryId,
      imageUrl: typeof body?.imageUrl === 'string' ? body.imageUrl : null,
      imageKey: typeof body?.imageKey === 'string' ? body.imageKey : null,
    });
    if (!result.success) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/employee/petty-cash/re-request]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
