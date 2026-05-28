// app/api/ops/transfers/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { executeTransfer } from '@/lib/db/utils/user-transfers';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { userId, toStoreId, roleId, employeeTypeId, notes, effectiveFrom, effectiveTo, isTemporary } = body;
  if (!userId || !toStoreId || !roleId) return NextResponse.json({ error: 'userId, toStoreId, roleId required.' }, { status: 400 });

  const result = await executeTransfer({
    actorId: session.user.id as string,
    userId,
    toStoreId: Number(toStoreId),
    roleId: Number(roleId),
    employeeTypeId: employeeTypeId != null ? Number(employeeTypeId) : null,
    notes: notes ?? null,
    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
    effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
    isTemporary: !!isTemporary,
  });

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, ...result.data });
}