// app/api/it/stores/[id]/route.ts
//
// DELETE — permanently removes a store and everything that belongs to it;
//          employees assigned to it end up with no store. IT-only, and only for
//          a store that is not `active`. Body: { confirmStoreNo } (the code is
//          typed in the dialog). See lib/db/utils/store-deletion.ts
//          (./deletion previews it).

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { deleteStore } from '@/lib/db/utils/store-deletion';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const storeId = Number((await params).id);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const confirmStoreNo = typeof body?.confirmStoreNo === 'string' ? body.confirmStoreNo : '';

  const result = await deleteStore({ storeId, confirmStoreNo });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  console.warn(`[store-deletion] ${scope.userId} deleted store ${result.data.storeNo} (${result.data.totalRemoved} rows)`);
  return NextResponse.json({ success: true, ...result.data });
}
