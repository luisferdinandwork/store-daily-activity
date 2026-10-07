// app/api/password-reset/request/route.ts
//
// POST { nik, email } — public "Lupa password" request (login screen).
// Always answers { success: true } for a well-formed request, whether or not
// the NIK + store email matched, so the form can't be used to probe NIKs. The
// emails go out after the response (`after`) for the same reason.
// Flow + rules: lib/db/utils/password-reset.ts.

import { NextRequest, NextResponse, after } from 'next/server';

import { clientIpFromHeaders } from '@/lib/auth/rate-limit';
import { takeToken } from '@/lib/auth/throttle';
import { submitResetRequest } from '@/lib/db/utils/password-reset';

const MINUTE = 60_000;

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(Object.fromEntries(req.headers));
  const body = await req.json().catch(() => null);
  const nik = typeof body?.nik === 'string' ? body.nik : '';
  const email = typeof body?.email === 'string' ? body.email : '';

  if (
    !takeToken(`pwreset:request:ip:${ip}`, 10, 15 * MINUTE) ||
    (nik.trim() && !takeToken(`pwreset:request:nik:${nik.trim().toLowerCase()}`, 3, 60 * MINUTE))
  ) {
    return NextResponse.json(
      { success: false, error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' },
      { status: 429 },
    );
  }

  const result = await submitResetRequest({ nik, email, ip, userAgent: req.headers.get('user-agent') });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  const followUp = result.followUp;
  if (followUp) {
    after(() => followUp().catch((err) => console.error('[password-reset] request follow-up failed:', err)));
  }
  return NextResponse.json({ success: true });
}
