// app/api/account/password-status/route.ts
//
// GET — the current user's 90-day password-policy status. Backs the
// PasswordExpiryBanner shown in every non-IT panel.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getPasswordStatus } from '@/lib/db/utils/password-policy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const status = await getPasswordStatus(userId);
  if (!status) {
    return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...status });
}
