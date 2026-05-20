// app/api/ops/users/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import { listOpsManagedUsers } from '@/lib/db/utils/user-assignments';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = session?.user?.id;

    if (!actorId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';

    const result = await listOpsManagedUsers(actorId, q);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('GET /api/ops/users failed:', error);
    return NextResponse.json(
      { error: 'Failed to load OPS users.' },
      { status: 500 },
    );
  }
}
