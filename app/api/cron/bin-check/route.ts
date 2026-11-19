// app/api/cron/bin-check/route.ts
//
// Hourly: keeps the monthly Cek Bin round (lib/db/utils/bin-round.ts → runBinRoundCron) fresh without anybody
// opening a page —
//   • queues a Business Central read of every active store's bin list that is older than ~20 h (slow, so it runs
//     in the background, three stores at a time; this call returns at once),
//   • makes this month's rows for every store whose list is known (a new month starts over by itself),
//   • reads BC's scans of the month so far into the saved monthly stats,
//   • reads last month one last time and freezes it once it is over.
//
// Manual run: /api/cron/bin-check (dev needs no secret; production wants the Authorization header).

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { runBinRoundCron } from '@/lib/db/utils/bin-round';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = verifyCronRequest(req);
  if (denied) return denied;
  try {
    const result = await runBinRoundCron();
    const ok = result.current !== 'unavailable';
    return NextResponse.json({ success: ok, ...result }, { status: ok ? 200 : 502 });
  } catch (err) {
    console.error('[cron/bin-check] failed', err);
    return NextResponse.json({ success: false, error: 'bin-check cron failed' }, { status: 500 });
  }
}
