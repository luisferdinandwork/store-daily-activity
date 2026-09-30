// app/api/finance/setoran/verify/route.ts
//
// POST { taskIds: number[] } — verify several completed setoran at once.
// Tasks that are not completed, or were already verified, are skipped rather
// than failing the whole batch (see verifySetoranTasks).

import { NextRequest, NextResponse } from 'next/server';
import { resolveFinanceScope } from '@/lib/finance/scope';
import { verifySetoranTasks } from '@/lib/db/utils/setoran-review';

const MAX_BATCH = 500;

export async function POST(req: NextRequest) {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    const body = await req.json().catch(() => null);
    const raw: unknown = body?.taskIds;
    const taskIds = Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is number => Number.isInteger(id) && id > 0))]
      : [];

    if (taskIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Pilih minimal satu setoran.' }, { status: 400 });
    }
    if (taskIds.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Maksimal ${MAX_BATCH} setoran sekali verifikasi.` },
        { status: 400 },
      );
    }

    const verifiedIds = await verifySetoranTasks(taskIds, scope.userId);
    return NextResponse.json({
      success: true,
      verified: verifiedIds.length,
      skipped: taskIds.length - verifiedIds.length,
    });
  } catch (err) {
    console.error('[POST /api/finance/setoran/verify]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
