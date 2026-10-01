// app/api/it/users/[id]/deletion/route.ts
//
// GET — what deleting this account would do, so the IT Users page can show it
// before asking: the records removed with it, the cash records that stay as
// history (shown as a notice) and the other records that stay. IT-only. It runs
// the real delete and rolls back (lib/db/utils/user-deletion.ts).

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { previewUserDeletion } from '@/lib/db/utils/user-deletion';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const result = await previewUserDeletion(id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, isSelf: id === scope.userId, ...result.data });
}
