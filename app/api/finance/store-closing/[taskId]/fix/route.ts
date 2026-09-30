// app/api/finance/store-closing/[taskId]/fix/route.ts
//
// POST — Finance marks a held Open Statement as fixed: the statement becomes
// POSTED, the closing completes and the linked hold issue is closed
// (see markStatementFixed).

import { NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { markStatementFixed } from '@/lib/db/utils/store-closing-review';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { taskId: raw } = await params;
  const taskId = Number(raw);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid taskId.' }, { status: 400 });
  }

  try {
    const result = await markStatementFixed(taskId, scope.userId);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, taskId: result.taskId });
  } catch (err) {
    console.error('[POST /api/finance/store-closing/[taskId]/fix]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
