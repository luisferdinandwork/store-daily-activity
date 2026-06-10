// app/api/ops/issues/[id]/route.ts
//
// PATCH — advance an Ops-assigned issue's status:
// reported → in_review → resolved.
//
// Important:
// - Next.js 15/16 dynamic params are Promise-based.
// - Draft issues are employee-only and must not be handled by OPS yet.
// - Multi-role routing uses issue_role_assignments.
// - assignedToRoleId is kept only as backward-compatible fallback.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  issues,
  stores,
  users,
  userRoles,
  employeeTypes,
  issueRoleAssignments,
} from '@/lib/db/schema';
import {
  loadIssueAssignedRoles,
  serializeIssue,
  type IssueStatus,
} from '@/lib/db/utils/issues';
import { reopenStoreClosingHoldForIssue } from '@/lib/db/utils/store-closing';

const VALID_STATUSES: IssueStatus[] = ['reported', 'in_review', 'resolved'];

function isValidOpsStatus(value: string): value is IssueStatus {
  return VALID_STATUSES.includes(value as IssueStatus);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const issueId = Number(id);
    if (!Number.isFinite(issueId) || issueId <= 0) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedStatus = String(body.status ?? '');

    if (!isValidOpsStatus(requestedStatus)) {
      return NextResponse.json(
        { error: 'Invalid status. OPS can only use reported, in_review, or resolved.' },
        { status: 400 },
      );
    }

    const userId = (session.user as any).id as string;

    const [actor] = await db
      .select({
        id: users.id,
        areaId: users.areaId,
        roleCode: userRoles.code,
        empType: employeeTypes.code,
      })
      .from(users)
      .leftJoin(userRoles, eq(users.roleId, userRoles.id))
      .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!actor || (actor.roleCode !== 'ops' && actor.roleCode !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isHO = actor.empType === 'ops_ho' || actor.roleCode === 'admin';

    const [opsRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'ops'))
      .limit(1);

    if (!opsRole) {
      return NextResponse.json({ error: 'Ops role missing' }, { status: 500 });
    }

    const [target] = await db
      .select({
        id: issues.id,
        status: issues.status,
        assignedToRoleId: issues.assignedToRoleId,
        reviewedAt: issues.reviewedAt,
        storeAreaId: stores.areaId,
      })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (target.status === 'draft') {
      return NextResponse.json(
        { error: 'This issue is still a draft and has not been sent to OPS yet.' },
        { status: 403 },
      );
    }

    const [opsAssignment] = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(
        and(
          eq(issueRoleAssignments.issueId, issueId),
          eq(issueRoleAssignments.roleId, opsRole.id),
        ),
      )
      .limit(1);

    const routedToOps = !!opsAssignment || target.assignedToRoleId === opsRole.id;

    if (!routedToOps) {
      return NextResponse.json(
        { error: 'This issue is not routed to Ops.' },
        { status: 403 },
      );
    }

    if (!isHO && target.storeAreaId !== actor.areaId) {
      return NextResponse.json({ error: 'Out of your area' }, { status: 403 });
    }

    const patch: Record<string, unknown> = {
      status: requestedStatus,
      updatedAt: new Date(),
    };

    if (requestedStatus !== 'reported') {
      patch.reviewedBy = actor.id;
      patch.reviewedAt = target.reviewedAt ?? new Date();
    }

    const [updated] = await db
      .update(issues)
      .set(patch)
      .where(eq(issues.id, issueId))
      .returning();

    if (requestedStatus === 'resolved') {
      await reopenStoreClosingHoldForIssue(issueId);
    }

    const assignedRoles = (await loadIssueAssignedRoles([issueId])).get(issueId) ?? [];

    return NextResponse.json({
      success: true,
      issue: serializeIssue(updated, assignedRoles),
    });
  } catch (err) {
    console.error('[PATCH /api/ops/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
