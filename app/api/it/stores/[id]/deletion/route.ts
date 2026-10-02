// app/api/it/stores/[id]/deletion/route.ts
//
// GET — what deleting this store would do (rows removed per table, employees
// left without a store, photos deleted), so the dialog can show it first. It
// runs the real delete and rolls back (lib/db/utils/store-deletion.ts). IT-only.

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { previewStoreDeletion } from '@/lib/db/utils/store-deletion';

export async function GET(
  _req: Request,
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

  const result = await previewStoreDeletion(storeId);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, ...result.data });
}
