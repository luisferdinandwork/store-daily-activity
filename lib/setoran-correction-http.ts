// lib/setoran-correction-http.ts
//
// The request handling behind "Koreksi Setoran", shared by the IT endpoint
// (/api/ops/setoran-correction) and the Finance one (/api/finance/setoran-correction).
// Each route does its own role check and passes the signed-in user's id in;
// everything else — the ledger read and the correction writes — is identical.
//
// GET  ?                    → stores with submitted setoran
// GET  ?storeId=&days=      → that store's ledger + correction history
// POST { taskId, received, stored, reason }
//      Corrects one submitted day and recalculates the carry-over of every later
//      day (see lib/db/utils/setoran-correction.ts).
// POST { storeId, date, received, stored, reason }
//      Fills in a day that has no submitted setoran (nothing, or an unsubmitted
//      draft), then recalculates the days after it.

import { NextRequest, NextResponse } from 'next/server';

import {
  LEDGER_DEFAULT_DAYS,
  LEDGER_MAX_DAYS,
  applySetoranCorrection,
  createSetoranForDate,
  getSetoranLedger,
  listCorrectableStores,
  type ApplyCorrectionData,
} from '@/lib/db/utils/setoran-correction';
import type { CorrectableStore, SetoranLedgerView } from '@/lib/setoran-correction';

export type SetoranCorrectionGetResponse =
  | { success: true; stores: CorrectableStore[] }
  | { success: true; ledger: SetoranLedgerView }
  | { success: false; error: string };

export type SetoranCorrectionPostResponse =
  | { success: true; data: ApplyCorrectionData }
  | { success: false; error: string };

export async function handleSetoranCorrectionGet(
  req: NextRequest,
  logTag: string,
): Promise<NextResponse<SetoranCorrectionGetResponse>> {
  try {
    const storeIdParam = req.nextUrl.searchParams.get('storeId');
    if (storeIdParam == null) {
      return NextResponse.json({ success: true, stores: await listCorrectableStores() });
    }

    const storeId = Number(storeIdParam);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid storeId.' }, { status: 400 });
    }

    const daysParam = Number(req.nextUrl.searchParams.get('days') ?? LEDGER_DEFAULT_DAYS);
    const days = Number.isFinite(daysParam)
      ? Math.min(LEDGER_MAX_DAYS, Math.max(7, Math.trunc(daysParam)))
      : LEDGER_DEFAULT_DAYS;

    const ledger = await getSetoranLedger(storeId, days);
    if (!ledger) {
      return NextResponse.json({ success: false, error: 'Store tidak ditemukan.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ledger });
  } catch (err) {
    console.error(`[GET ${logTag}]`, err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function handleSetoranCorrectionPost(
  req: NextRequest,
  userId: string,
  logTag: string,
): Promise<NextResponse<SetoranCorrectionPostResponse>> {
  let body: {
    taskId?: unknown; storeId?: unknown; date?: unknown;
    received?: unknown; stored?: unknown; reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { taskId, storeId, date, received, stored, reason } = body;
  if (typeof received !== 'number' || typeof stored !== 'number') {
    return NextResponse.json({ success: false, error: 'Nominal diterima dan disetor wajib diisi.' }, { status: 400 });
  }
  const reasonText = typeof reason === 'string' ? reason : '';

  try {
    let result;
    if (taskId !== undefined) {
      // Correct a submitted day.
      if (typeof taskId !== 'number' || !Number.isInteger(taskId) || taskId <= 0) {
        return NextResponse.json({ success: false, error: 'Invalid taskId.' }, { status: 400 });
      }
      result = await applySetoranCorrection({
        taskId, received, stored, reason: reasonText, correctedBy: userId,
      });
    } else {
      // Fill in a day that has no submitted setoran.
      if (typeof storeId !== 'number' || !Number.isInteger(storeId) || storeId <= 0 || typeof date !== 'string') {
        return NextResponse.json({ success: false, error: 'storeId dan date wajib diisi.' }, { status: 400 });
      }
      result = await createSetoranForDate({
        storeId, date, received, stored, reason: reasonText, createdBy: userId,
      });
    }

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    console.error(`[POST ${logTag}]`, err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
