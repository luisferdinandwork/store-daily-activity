// app/api/cron/revert-transfers/route.ts
import { NextResponse } from 'next/server';
import { autoRevertExpiredTransfers } from '../../../../lib/db/utils/user-transfers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const systemActorId = process.env.SYSTEM_ACTOR_ID; // an admin/HO user id
  if (!systemActorId) {
    return NextResponse.json({ error: 'SYSTEM_ACTOR_ID not configured' }, { status: 500 });
  }

  const result = await autoRevertExpiredTransfers(systemActorId);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result.data); // { reverted, errors }
}