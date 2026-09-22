// app/api/cron/revert-transfers/route.ts
import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/cron';
import { autoRevertExpiredTransfers } from '../../../../lib/db/utils/user-transfers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Fails closed when CRON_SECRET is unset in production (lib/auth/cron.ts).
  const denied = verifyCronRequest(req);
  if (denied) return denied;

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