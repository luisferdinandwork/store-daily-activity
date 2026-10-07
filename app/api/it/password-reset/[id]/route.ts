// app/api/it/password-reset/[id]/route.ts
//
// POST { action: 'send_link' }          — IT verified the request: email a fresh
//                                          one-time link to the store mailbox
//                                          (also "resend" for an expired/locked link).
// POST { action: 'reject', reason? }    — close it; the store mailbox is told.
// Rules: lib/db/utils/password-reset.ts.

import { NextRequest, NextResponse, after } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { rejectResetRequest, sendResetLink } from '@/lib/db/utils/password-reset';

type Params = { params: Promise<{ id: string }> };

/** Origin as the browser sees it (nginx terminates TLS) — only used when NEXTAUTH_URL is unset. */
function publicOrigin(req: NextRequest): string {
  const first = (v: string | null) => v?.split(',')[0].trim() || null;
  const proto = first(req.headers.get('x-forwarded-proto')) ?? req.nextUrl.protocol.replace(':', '');
  const host = first(req.headers.get('x-forwarded-host')) ?? req.headers.get('host') ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await guardApi(['it']);
  if (!guard.ok) return guard.response;

  const { id: idRaw } = await params;
  const requestId = Number(idRaw);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  if (body?.action === 'send_link') {
    const result = await sendResetLink({ requestId, actorId: guard.user.id, fallbackOrigin: publicOrigin(req) });
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, outcome: result.data });
  }

  if (body?.action === 'reject') {
    const result = await rejectResetRequest({
      requestId,
      actorId: guard.user.id,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    const followUp = result.data.followUp;
    after(() => followUp().catch((err) => console.error('[password-reset] reject follow-up failed:', err)));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action.' }, { status: 400 });
}
