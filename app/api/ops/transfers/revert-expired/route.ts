// app/api/ops/transfers/revert-expired/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { autoRevertExpiredTransfers } from '@/lib/db/utils/user-transfers';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const result = await autoRevertExpiredTransfers(session.user.id as string);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, ...result.data });
}