// app/api/ops/setoran-correction/history/route.ts
//
// IT-only (page: /it/setoran-correction/history; IT APIs stay under /api/ops/*).
// Every correction / addition made on any store. Finance has its own copy at
// /api/finance/setoran-correction/history; the handling lives in
// lib/setoran-correction-http.ts.

import { NextRequest, NextResponse } from 'next/server';
import { resolveItScope } from '@/lib/auth/it-scope';
import {
  handleSetoranCorrectionHistoryGet,
  type SetoranCorrectionHistoryResponse,
} from '@/lib/setoran-correction-http';

export type { SetoranCorrectionHistoryResponse };

export async function GET(req: NextRequest): Promise<NextResponse<SetoranCorrectionHistoryResponse>> {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  return handleSetoranCorrectionHistoryGet(req, '/api/ops/setoran-correction');
}
