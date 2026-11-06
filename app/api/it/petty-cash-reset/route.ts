// app/api/it/petty-cash-reset/route.ts
//
// IT-only "Reset Petty Cash" (lib/db/utils/petty-cash-reset.ts, shapes in lib/petty-cash-reset.ts).
//
//   GET                                       — every store with how much petty cash it holds
//   GET ?storeId=N                            — that store's periods
//   GET ?storeId=N&scope=period&month=YYYY-MM — what resetting that period would do (counts, nothing changes)
//   GET ?storeId=N&scope=all                  — what resetting every period would do
//        … &backup=1                          — the rows that would go, as a JSON download
//   POST { storeId, scope: 'period'|'all', month?, confirmStoreNo } — do it (store code typed back to confirm)

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import {
  exportResetBackup,
  getResetOverview,
  listResetStores,
  previewPettyCashReset,
  resetPettyCash,
} from '@/lib/db/utils/petty-cash-reset';
import { parseResetScope } from '@/lib/petty-cash-reset';

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

function parseStoreId(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  const q = req.nextUrl.searchParams;
  try {
    if (!q.has('storeId')) {
      return NextResponse.json({ success: true, stores: await listResetStores() });
    }

    const storeId = parseStoreId(q.get('storeId'));
    if (!storeId) return fail('Invalid storeId.', 400);

    if (!q.has('scope')) {
      const result = await getResetOverview(storeId);
      if (!result.success) return fail(result.error, result.status);
      return NextResponse.json({ success: true, ...result.data });
    }

    const resetScope = parseResetScope(q.get('scope'), q.get('month'));
    if (!resetScope) return fail('Pick "all" or a period (scope=period&month=YYYY-MM).', 400);

    if (q.get('backup') === '1') {
      const result = await exportResetBackup(storeId, resetScope);
      if (!result.success) return fail(result.error, result.status);
      return new NextResponse(JSON.stringify(result.data.body, null, 1), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.data.filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const result = await previewPettyCashReset(storeId, resetScope);
    if (!result.success) return fail(result.error, result.status);
    return NextResponse.json({ success: true, ...result.data });
  } catch (err) {
    console.error('[GET /api/it/petty-cash-reset]', err);
    return fail('Failed to load petty cash.', 500);
  }
}

export async function POST(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  const body = await req.json().catch(() => null);
  const storeId = parseStoreId(body?.storeId);
  if (!storeId) return fail('Invalid storeId.', 400);

  const resetScope = parseResetScope(body?.scope, body?.month);
  if (!resetScope) return fail('Pick "all" or a period (scope: "period" + month: "YYYY-MM").', 400);

  try {
    // The store code typed back is the confirmation — same as deleting a store.
    const preview = await previewPettyCashReset(storeId, resetScope);
    if (!preview.success) return fail(preview.error, preview.status);

    const typed = typeof body?.confirmStoreNo === 'string' ? body.confirmStoreNo.trim().toUpperCase() : '';
    if (typed !== preview.data.store.storeNo.toUpperCase()) {
      return fail(`Type the store code ${preview.data.store.storeNo} to confirm.`, 400);
    }

    const result = await resetPettyCash(storeId, resetScope);
    if (!result.success) return fail(result.error, result.status);

    const d = result.data.deleted;
    console.warn(
      `[petty-cash-reset] ${scope.userId} reset ${resetScope.type === 'all' ? 'ALL periods' : `period ${resetScope.yearMonth}`} of ` +
        `${result.data.store.storeNo}: ${d.requests} requests, ${d.refillRequests} refill requests, ${d.legacyRefills} legacy refills, ` +
        `${d.periods} periods, ${d.notifications} notifications deleted` +
        (preview.data.refillsVerified ? ` (${preview.data.refillsVerified} Finance-verified refill(s), Rp ${preview.data.transferredAmount})` : ''),
    );

    return NextResponse.json({ success: true, ...result.data });
  } catch (err) {
    console.error('[POST /api/it/petty-cash-reset]', err);
    return fail(err instanceof Error ? err.message : 'Failed to reset petty cash.', 500);
  }
}
