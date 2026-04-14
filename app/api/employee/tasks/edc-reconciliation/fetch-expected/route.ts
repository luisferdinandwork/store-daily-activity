// app/api/employee/tasks/edc-reconciliation/fetch-expected/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Idempotent expected-data fetcher. Front-end calls this on task open.
// Returns the stored snapshot if present; otherwise generates one via the
// dummy generator and persists it.
//
// Later you can replace the internal call with a real back-office API — the
// contract (returning an ExpectedEdcSnapshot) stays the same.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { fetchExpectedForTask }      from '@/lib/db/utils/edc-reconciliation';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const taskId = parseInt(String(body.taskId ?? ''), 10);
  if (isNaN(taskId))
    return NextResponse.json({ success: false, error: 'taskId must be a valid integer' }, { status: 400 });

  try {
    const result = await fetchExpectedForTask(taskId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/edc-reconciliation/fetch-expected]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}