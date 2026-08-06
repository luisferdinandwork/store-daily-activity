// app/api/employee/tasks/item-dropping/route.ts
//
// The old batch submit/add_entry/remove-entry flow has been retired — entries
// are now BC-driven only (see app/api/employee/tasks/item-dropping/[id]/route.ts
// for the live-sync GET + per-transfer-order confirm POST). This route just
// keeps the notes-only autosave.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { autoSaveItemDroppingById, type AutoSaveItemDroppingPatch } from '@/lib/db/utils/item-dropping';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let taskId: number;
  try { taskId = toInt(body.taskId, 'taskId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveItemDroppingPatch = {};
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveItemDroppingById(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/item-dropping]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
