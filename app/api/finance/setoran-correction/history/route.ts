// app/api/finance/setoran-correction/history/route.ts
//
// Finance's "Riwayat Koreksi" (page: /finance/setoran-correction/history). Same
// data as IT's endpoint (/api/ops/setoran-correction/history); only who may call
// it differs. See lib/setoran-correction-http.ts.

import { NextRequest } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { handleSetoranCorrectionHistoryGet } from '@/lib/setoran-correction-http';

export async function GET(req: NextRequest) {
  const guard = await guardApi(['finance', 'it']);
  if (!guard.ok) return guard.response;

  return handleSetoranCorrectionHistoryGet(req, '/api/finance/setoran-correction');
}
