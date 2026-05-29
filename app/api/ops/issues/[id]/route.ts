// app/api/ops/issues/[id]/route.ts
//
// PATCH — advance an Ops-assigned issue's status (reported → in_review → resolved).
// Authorization mirrors the list route: the issue must be assigned to Ops AND
// (the actor is HO/admin OR the issue's store is in the actor's area).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, stores, users, userRoles, employeeTypes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

const VALID: ReadonlyArray<string> = ['reported', 'in_review', 'resolved'];

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const issueId = Number(params.id);
  if (!Number.isFinite(issueId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? '');
  if (!VALID.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const userId = (session.user as any).id as string;

  const [actor] = await db
    .select({
      id: users.id, areaId: users.areaId,
      roleCode: userRoles.code, empType: employeeTypes.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId));

  if (!actor || (actor.roleCode !== 'ops' && actor.roleCode !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const isHO = actor.empType === 'ops_ho' || actor.roleCode === 'admin';

  const [opsRole] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.code, 'ops'));

  // Load the issue + its store area for the scope check.
  const [target] = await db
    .select({
      id: issues.id, assignedToRoleId: issues.assignedToRoleId,
      reviewedAt: issues.reviewedAt, storeAreaId: stores.areaId,
    })
    .from(issues)
    .innerJoin(stores, eq(issues.storeId, stores.id))
    .where(eq(issues.id, issueId));

  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.assignedToRoleId !== opsRole?.id) {
    return NextResponse.json({ error: 'This issue is not routed to Ops' }, { status: 403 });
  }
  if (!isHO && target.storeAreaId !== actor.areaId) {
    return NextResponse.json({ error: 'Out of your area' }, { status: 403 });
  }

  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status !== 'reported') {
    patch.reviewedBy = actor.id;
    patch.reviewedAt = target.reviewedAt ?? new Date(); // stamp first review only
  }

  const [row] = await db.update(issues).set(patch).where(eq(issues.id, issueId)).returning();

  return NextResponse.json({
    success: true,
    issue: { ...row, id: String(row.id), storeId: String(row.storeId) },
  });
}