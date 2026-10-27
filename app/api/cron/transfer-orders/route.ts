// app/api/cron/transfer-orders/route.ts
//
// Every 5 minutes: pull Business Central's transfer orders + warehouse
// shipments into the registry, close the ones BC has received, and tell the
// stores about anything new (lib/db/utils/transfer-order-refresh.ts).
//
// This is what makes the timestamps trustworthy — BC's transfer-order feed
// carries only a date, so "TO created" is the moment our sweep first sees it,
// and without this job that was whenever somebody next opened a page (on
// staging, every order had the same "created" instant, days after the fact).
// It is also what makes the badge/bell notice a new order by itself.
//
// Manual run: /api/cron/transfer-orders (dev needs no secret; production wants
// the Authorization header).

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { refreshReceivingStatus, refreshTransferRegistry } from '@/lib/db/utils/transfer-order-refresh';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

  // Registry first (it announces), then receiving; both reuse an in-flight
  // sweep if a page open started one a moment ago.
  const registry = await refreshTransferRegistry({ maxAgeMs: 0 });
  const receiving = await refreshReceivingStatus({ maxAgeMs: 0 });

  const ok = registry.error == null && registry.notifyError == null && receiving.error == null;
  return NextResponse.json({ success: ok, registry, receiving }, { status: ok ? 200 : 502 });
}
