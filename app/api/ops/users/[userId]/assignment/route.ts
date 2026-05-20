// app/api/ops/users/[userId]/assignment/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import {
  getUserAssignmentHistory,
  updateUserAssignment,
} from '@/lib/db/utils/user-assignments';

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = session?.user?.id;

    if (!actorId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { userId } = await params;
    const result = await getUserAssignmentHistory(actorId, userId);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }

    return NextResponse.json({ history: result.data });
  } catch (error) {
    console.error('GET /api/ops/users/[userId]/assignment failed:', error);
    return NextResponse.json(
      { error: 'Failed to load assignment history.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = session?.user?.id;

    if (!actorId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { userId } = await params;
    const body = await request.json();

    const storeId = toPositiveInt(body.storeId);
    const roleId = toPositiveInt(body.roleId);
    const employeeTypeId = body.employeeTypeId == null || body.employeeTypeId === ''
      ? null
      : toPositiveInt(body.employeeTypeId);

    if (!storeId) {
      return NextResponse.json({ error: 'storeId is required.' }, { status: 400 });
    }

    if (!roleId) {
      return NextResponse.json({ error: 'roleId is required.' }, { status: 400 });
    }

    if (body.employeeTypeId != null && body.employeeTypeId !== '' && !employeeTypeId) {
      return NextResponse.json({ error: 'employeeTypeId is invalid.' }, { status: 400 });
    }

    const result = await updateUserAssignment({
      actorId,
      userId,
      storeId,
      roleId,
      employeeTypeId,
      notes: typeof body.notes === 'string' ? body.notes : null,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...result.data });
  } catch (error) {
    console.error('PATCH /api/ops/users/[userId]/assignment failed:', error);
    return NextResponse.json(
      { error: 'Failed to update user assignment.' },
      { status: 500 },
    );
  }
}
