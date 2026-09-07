// app/api/account/change-password/route.ts
//
// POST — any authenticated user changes their own password. Role-agnostic;
// the Ops / Finance / Audit settings screens post here. Employees have their
// own thin wrapper at /api/employee/change-password, but both call the same
// changeOwnPassword() util.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { changeOwnPassword } from '@/lib/db/utils/account';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  const userId = (session.user as { id: string }).id;
  const result = await changeOwnPassword(userId, currentPassword, newPassword);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true });
}
