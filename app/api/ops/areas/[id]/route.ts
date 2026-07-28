// app/api/ops/areas/[id]/route.ts
// PATCH /api/ops/areas/:id — rename an area. OPS HO only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { areas } from '@/lib/db/schema/core';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor(userId);
  if (!actor?.isOpsHo) {
    return NextResponse.json({ success: false, error: 'OPS HO access only.' }, { status: 403 });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid area id' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ success: false, error: 'Area name is required.' }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(areas)
      .set({ name, updatedAt: new Date() })
      .where(eq(areas.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Area not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, area: updated });
  } catch (err) {
    console.error('PATCH /api/ops/areas/[id] failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to update area' }, { status: 500 });
  }
}
