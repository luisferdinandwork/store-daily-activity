// app/api/employee/petty-cash/re-request/route.ts
//
// POST { originalTxId, requestDate, description, actualAmount, imageUrl?, imageKey? }
//
// PIC 1 files a request Finance turned down (Ditolak) again, in the store's current period
// (lib/petty-cash-re-request.ts). No Ops step: the new request is created already completed — the usage and
// the receipt are what Finance reviews. The day it is filed is recorded automatically; `requestDate` is the
// day PIC 1 says the original request was made.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/core';
import { isPettyCashHolder } from '@/lib/db/utils/petty-cash-refill';
import { createReRequest } from '@/lib/db/utils/petty-cash-re-request';
import { assertStoreOperational } from '@/lib/db/utils/store-status';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const employeeType = (session?.user as { employeeType?: string | null } | undefined)?.employeeType;
  if (!isPettyCashHolder(employeeType)) {
    return NextResponse.json(
      { success: false, error: 'Hanya PIC 1 yang bisa mengajukan Re-request Petty Cash.' },
      { status: 403 },
    );
  }

  const [user] = await db.select({ homeStoreId: users.homeStoreId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.homeStoreId) {
    return NextResponse.json({ success: false, error: 'No store assigned.' }, { status: 403 });
  }

  const inactive = await assertStoreOperational(user.homeStoreId);
  if (inactive) return NextResponse.json({ success: false, error: inactive }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const originalTxId = Number(body.originalTxId);
  if (!Number.isInteger(originalTxId) || originalTxId <= 0) {
    return NextResponse.json({ success: false, error: 'Pilih request yang ditolak.' }, { status: 400 });
  }

  try {
    const result = await createReRequest({
      originalTxId,
      storeId: user.homeStoreId,
      userId,
      requestDate: body.requestDate,
      description: body.description,
      actualAmount: body.actualAmount,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : null,
      imageKey: typeof body.imageKey === 'string' ? body.imageKey : null,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, txId: result.txId, newBalance: result.newBalance }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/employee/petty-cash/re-request]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
