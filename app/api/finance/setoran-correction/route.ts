// app/api/finance/setoran-correction/route.ts
//
// Finance's "Koreksi Setoran" (page: /finance/setoran-correction). Same ledger
// and the same correction logic as IT's endpoint (/api/ops/setoran-correction);
// the only difference is who may call it and who the correction is recorded
// against. See lib/setoran-correction-http.ts for the request shapes.

import { NextRequest } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import {
  handleSetoranCorrectionGet,
  handleSetoranCorrectionPost,
} from '@/lib/setoran-correction-http';

export async function GET(req: NextRequest) {
  const guard = await guardApi(['finance', 'it']);
  if (!guard.ok) return guard.response;

  return handleSetoranCorrectionGet(req, '/api/finance/setoran-correction');
}

export async function POST(req: NextRequest) {
  const guard = await guardApi(['finance', 'it']);
  if (!guard.ok) return guard.response;

  return handleSetoranCorrectionPost(req, guard.user.id, '/api/finance/setoran-correction');
}
