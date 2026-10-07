// app/api/it/password-reset/route.ts
//
// GET            — IT "Reset Password" page: open requests + recent closed ones, with
//                  counts, and whether real email delivery (Microsoft Graph) is configured.
// GET ?count=1   — just the number waiting on IT (sidebar badge): pending + expired/locked links.

import { NextRequest, NextResponse } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { countRequestsNeedingIt, listResetRequests } from '@/lib/db/utils/password-reset';
import { isMailConfigured, mailFromAddress } from '@/lib/email/graph-mail';

export async function GET(req: NextRequest) {
  const guard = await guardApi(['it']);
  if (!guard.ok) return guard.response;

  if (req.nextUrl.searchParams.get('count') === '1') {
    return NextResponse.json({ success: true, count: await countRequestsNeedingIt() });
  }

  const { rows, counts } = await listResetRequests();
  return NextResponse.json({
    success: true,
    rows,
    counts,
    mail: { configured: isMailConfigured(), from: mailFromAddress() },
  });
}
