// app/api/ops/users/workspace/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listManageData } from '@/lib/db/utils/user-transfers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const result = await listManageData(session.user.id as string);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 403 });

  return NextResponse.json(result.data);
}