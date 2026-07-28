// app/api/cron/cleanup-task-images/route.ts
//
// Verifying this is safe: hit with ?dryRun=1 (and optionally
// &retentionDays=0 to include everything) to see exactly which rows/URLs
// the join logic matches — nothing is deleted or nulled in dry-run mode.
// Locally, CRON_SECRET is normally unset, so this works straight from a
// browser: /api/cron/cleanup-task-images?dryRun=1&retentionDays=0
import { NextResponse } from 'next/server';
import { cleanupOldTaskImages } from '@/lib/db/utils/task-image-cleanup';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const retentionParam = url.searchParams.get('retentionDays');
  const retentionDays = retentionParam !== null ? Number(retentionParam) : undefined;

  const summary = await cleanupOldTaskImages({
    dryRun,
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : undefined,
  });
  return NextResponse.json(summary);
}
