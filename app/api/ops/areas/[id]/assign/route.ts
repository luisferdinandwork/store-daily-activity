// app/api/ops/areas/[id]/assign/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/areas/:id/assign
// Body: { userId: string | null }
//
// Assigns (or clears) the single OPS Area user responsible for an area.
// Area ↔ OPS Area user is enforced one-to-one here at the application level:
//   1. Whoever currently covers this area gets displaced (areaId cleared).
//   2. The target user's areaId is set to this area — which, being a single
//      column, automatically drops whatever area they covered before.
//
// Note: the Neon HTTP driver this app uses (drizzle-orm/neon-http) doesn't
// support interactive transactions, so these are sequential awaited writes,
// not an atomic transaction (same constraint the rest of this codebase's
// multi-step writes already live with — see scripts/seed-shift-tasks.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { areas, users } from '@/lib/db/schema/core';
import { employeeTypes } from '@/lib/db/schema/lookups';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const actorUserId = session?.user?.id as string | undefined;
  if (!actorUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor(actorUserId);
  if (!actor?.isOpsHo) {
    return NextResponse.json({ success: false, error: 'OPS HO access only.' }, { status: 403 });
  }

  const { id: idRaw } = await params;
  const areaId = Number(idRaw);
  if (!Number.isInteger(areaId) || areaId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid area id' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !('userId' in body) || (body.userId !== null && typeof body.userId !== 'string')) {
    return NextResponse.json({ success: false, error: 'userId (string or null) is required.' }, { status: 400 });
  }
  const targetUserId: string | null = body.userId;

  const [area] = await db.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.id, areaId)).limit(1);
  if (!area) {
    return NextResponse.json({ success: false, error: 'Area not found' }, { status: 404 });
  }

  const [opsAreaType] = await db
    .select({ id: employeeTypes.id })
    .from(employeeTypes)
    .where(eq(employeeTypes.code, 'ops_area'))
    .limit(1);
  if (!opsAreaType) {
    return NextResponse.json({ success: false, error: 'ops_area employee type is not configured.' }, { status: 500 });
  }

  try {
    if (targetUserId === null) {
      // Unassign — clear whoever currently covers this area.
      await db
        .update(users)
        .set({ areaId: null, updatedAt: new Date() })
        .where(and(eq(users.areaId, areaId), eq(users.employeeTypeId, opsAreaType.id)));

      return NextResponse.json({ success: true, area: { id: area.id, name: area.name }, opsUser: null });
    }

    const [targetUser] = await db
      .select({ id: users.id, name: users.name, nik: users.nik, employeeTypeId: users.employeeTypeId, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (targetUser.employeeTypeId !== opsAreaType.id) {
      return NextResponse.json({ success: false, error: 'Only OPS Area users can be assigned to an area.' }, { status: 400 });
    }
    if (!targetUser.isActive) {
      return NextResponse.json({ success: false, error: 'This user is inactive.' }, { status: 400 });
    }

    // 1) Displace whoever currently covers this area (if anyone else).
    await db
      .update(users)
      .set({ areaId: null, updatedAt: new Date() })
      .where(and(eq(users.areaId, areaId), eq(users.employeeTypeId, opsAreaType.id)));

    // 2) Assign the target user — overwrites their previous area, if any.
    await db
      .update(users)
      .set({ areaId, updatedAt: new Date() })
      .where(eq(users.id, targetUserId));

    return NextResponse.json({
      success: true,
      area: { id: area.id, name: area.name },
      opsUser: { id: targetUser.id, name: targetUser.name, nik: targetUser.nik },
    });
  } catch (err) {
    console.error('PATCH /api/ops/areas/[id]/assign failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to update assignment' }, { status: 500 });
  }
}
