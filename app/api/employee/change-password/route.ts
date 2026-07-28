// app/api/employee/change-password/route.ts
//
// POST — an employee changes their own password. Requires the current
// password (bcrypt.compare) and a new password of at least 6 characters,
// mirroring the same rule used at registration.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword) {
    return NextResponse.json({ success: false, error: 'Current password is required.' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ success: false, error: 'New password must be at least 6 characters.' }, { status: 400 });
  }

  const userId = (session.user as any).id as string;
  const [user] = await db.select({ id: users.id, password: users.password }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
  }

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) {
    return NextResponse.json({ success: false, error: 'Current password is incorrect.' }, { status: 401 });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ password: hashed, updatedAt: new Date() }).where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
