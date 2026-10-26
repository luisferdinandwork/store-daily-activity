// app/api/ops/setoran-correction/route.ts
//
// IT-only (page: /it/setoran-correction; IT APIs stay under /api/ops/*).
// Finance has its own copy at /api/finance/setoran-correction; the request
// shapes and the handling live in lib/setoran-correction-http.ts.

import { NextRequest, NextResponse } from 'next/server';
import { resolveItScope } from '@/lib/auth/it-scope';
import {
  handleSetoranCorrectionGet,
  handleSetoranCorrectionPost,
  type SetoranCorrectionGetResponse,
  type SetoranCorrectionPostResponse,
} from '@/lib/setoran-correction-http';

export type { SetoranCorrectionGetResponse, SetoranCorrectionPostResponse };

export async function GET(req: NextRequest): Promise<NextResponse<SetoranCorrectionGetResponse>> {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  return handleSetoranCorrectionGet(req, '/api/ops/setoran-correction');
}

export async function POST(req: NextRequest): Promise<NextResponse<SetoranCorrectionPostResponse>> {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  return handleSetoranCorrectionPost(req, scope.userId, '/api/ops/setoran-correction');
}
