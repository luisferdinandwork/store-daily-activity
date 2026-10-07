// app/api/password-reset/complete/route.ts
//
// POST { token, nik, password, confirmPassword } — set the new password through
// the emailed link. Only the NIK the link was made for is accepted; another NIK
// gets 403 { code: 'NIK_MISMATCH', error: 'Link ini bukan untuk NIK Anda.', attemptsLeft }.
// Rules: lib/db/utils/password-reset.ts (completeReset).

import { NextRequest, NextResponse, after } from 'next/server';

import { clientIpFromHeaders } from '@/lib/auth/rate-limit';
import { takeToken } from '@/lib/auth/throttle';
import { completeReset } from '@/lib/db/utils/password-reset';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(Object.fromEntries(req.headers));
  if (!takeToken(`pwreset:complete:ip:${ip}`, 20, 15 * 60_000)) {
    return NextResponse.json(
      { success: false, code: 'RATE_LIMIT', error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const result = await completeReset({
    token: str(body?.token),
    nik: str(body?.nik),
    password: str(body?.password),
    confirmPassword: str(body?.confirmPassword),
    ip,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, ...result.detail }, { status: result.status });
  }

  const followUp = result.followUp;
  after(() => followUp().catch((err) => console.error('[password-reset] complete follow-up failed:', err)));
  return NextResponse.json({ success: true });
}
