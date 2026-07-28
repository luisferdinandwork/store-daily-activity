// app/api/audit/issues/[id]/route.ts
//
// PATCH — advance an Audit-assigned issue's status:
//   in_review — Audit starts working it (optional; can be set any time from
//               "reported").
//   completed — Audit gives final closure, but ONLY once the reporter has
//               already marked the issue "solved" (employee-only, see
//               /api/employee/issues/[id]) — never the other way around.
//
// Audit sees every store — no area scoping (unlike Ops).

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { issues, userRoles, issueRoleAssignments } from '@/lib/db/schema';
import { resolveAuditScope } from '@/lib/audit/scope';
import {
  loadIssueAssignedRoles,
  notifyIssueEvent,
  serializeIssue,
  type IssueStatus,
} from '@/lib/db/utils/issues';

const VALID_STATUSES: IssueStatus[] = ['in_review', 'completed'];

function isValidStatus(value: string): value is IssueStatus {
  return VALID_STATUSES.includes(value as IssueStatus);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const scope = await resolveAuditScope();
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const issueId = Number(id);
    if (!Number.isFinite(issueId) || issueId <= 0) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedStatus = String(body.status ?? '');

    if (!isValidStatus(requestedStatus)) {
      return NextResponse.json(
        { error: 'Invalid status. Audit can only use in_review or completed.' },
        { status: 400 },
      );
    }

    const [auditRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'audit'))
      .limit(1);

    if (!auditRole) {
      return NextResponse.json({ error: 'Audit role missing' }, { status: 500 });
    }

    const [target] = await db
      .select({
        id: issues.id,
        storeId: issues.storeId,
        status: issues.status,
        assignedToRoleId: issues.assignedToRoleId,
        reviewedAt: issues.reviewedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (target.status === 'draft') {
      return NextResponse.json(
        { error: 'This issue is still a draft and has not been sent to Audit yet.' },
        { status: 403 },
      );
    }

    if (requestedStatus === 'completed' && target.status !== 'solved') {
      return NextResponse.json(
        { error: 'This issue must be resolved by the reporter before it can be marked complete.' },
        { status: 409 },
      );
    }

    const [auditAssignment] = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(
        and(
          eq(issueRoleAssignments.issueId, issueId),
          eq(issueRoleAssignments.roleId, auditRole.id),
        ),
      )
      .limit(1);

    const routedToAudit = !!auditAssignment || target.assignedToRoleId === auditRole.id;

    if (!routedToAudit) {
      return NextResponse.json(
        { error: 'This issue is not routed to Audit.' },
        { status: 403 },
      );
    }

    const patch: Record<string, unknown> = {
      status: requestedStatus,
      updatedAt: new Date(),
      reviewedBy: scope.userId,
      reviewedAt: target.reviewedAt ?? new Date(),
    };

    const [updated] = await db
      .update(issues)
      .set(patch)
      .where(eq(issues.id, issueId))
      .returning();

    const assignedRoles = (await loadIssueAssignedRoles([issueId])).get(issueId) ?? [];

    if (requestedStatus === 'completed') {
      await notifyIssueEvent({
        issueId,
        storeId: target.storeId,
        assignedRoles,
        type: 'issue_completed',
        title: `Issue completed: ${updated.title}`,
        body: 'Audit confirmed the resolution. Issue closed.',
        excludeUserId: scope.userId,
      });
    }

    return NextResponse.json({
      success: true,
      issue: serializeIssue(updated, assignedRoles),
    });
  } catch (err) {
    console.error('[PATCH /api/audit/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
