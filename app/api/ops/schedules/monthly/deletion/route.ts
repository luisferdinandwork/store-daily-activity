// app/api/ops/schedules/monthly/deletion/route.ts
//
// GET ?storeId=&yearMonth= — what each "Delete schedule" option would do
// (keep_history / all: days removed and kept, attendance + task records
// removed, Finance records kept), so the dialog can show it first. It runs the
// real delete and rolls back (lib/schedule-utils.ts). OPS / IT only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { previewMonthlyScheduleDeletion } from '@/lib/schedule-utils';

import { assertStoreInActorArea, getOpsActor, parseStoreId } from '../../_helpers';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actor = await getOpsActor(session.user.id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  const parsedStore = parseStoreId(req.nextUrl.searchParams.get('storeId'));
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');
  if (!parsedStore.ok) {
    return NextResponse.json({ success: false, error: parsedStore.error }, { status: 400 });
  }
  if (!yearMonth) {
    return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });
  }

  const areaError = await assertStoreInActorArea(actor, parsedStore.id);
  if (areaError) {
    return NextResponse.json({ success: false, error: areaError }, { status: 403 });
  }

  const result = await previewMonthlyScheduleDeletion(parsedStore.id, yearMonth, actor.id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, preview: result.data });
}
