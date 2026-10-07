// app/api/password-reset/link/route.ts
//
// POST { token } — can this emailed link still be used? Drives the
// /reset-password/<token> page: valid (with expiry) | invalid | expired | used | locked.
// Says nothing about whose link it is — the NIK is what the user must type.

import { NextRequest, NextResponse } from 'next/server';

import { clientIpFromHeaders } from '@/lib/auth/rate-limit';
import { takeToken } from '@/lib/auth/throttle';
import { checkResetLink } from '@/lib/db/utils/password-reset';

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(Object.fromEntries(req.headers));
  if (!takeToken(`pwreset:link:ip:${ip}`, 60, 15 * 60_000)) {
    return NextResponse.json(
      { success: false, error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  return NextResponse.json(await checkResetLink(token));
}
