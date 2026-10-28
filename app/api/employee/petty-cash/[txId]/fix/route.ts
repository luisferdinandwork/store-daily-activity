// app/api/employee/petty-cash/[txId]/fix/route.ts
//
// POST { description, actualAmount, imageUrl?, imageKey? }
//
// PIC 1 corrects a request Finance rejected (lib/petty-cash-review.ts) — Keterangan, the amount
// actually used and/or the receipt photo — and sends it back to Finance. Only possible until Finance
// verifies the refill that covers it; after that the rejection is permanent.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/core';
import { isPettyCashHolder } from '@/lib/db/utils/petty-cash-refill';
import { employeeFixTransaction } from '@/lib/db/utils/petty-cash-review';
import { assertStoreOperational } from '@/lib/db/utils/store-status';

type Params = { params: Promise<{ txId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const employeeType = (session?.user as { employeeType?: string | null } | undefined)?.employeeType;
  if (!isPettyCashHolder(employeeType)) {
    return NextResponse.json(
      { success: false, error: 'Hanya PIC 1 yang bisa memperbaiki Request Petty Cash.' },
      { status: 403 },
    );
  }

  const txId = Number((await params).txId);
  if (!Number.isInteger(txId) || txId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid txId.' }, { status: 400 });
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

  try {
    const result = await employeeFixTransaction({
      txId,
      storeId: user.homeStoreId,
      userId,
      description: body.description,
      actualAmount: body.actualAmount,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : null,
      imageKey: typeof body.imageKey === 'string' ? body.imageKey : null,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/employee/petty-cash/[txId]/fix]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
