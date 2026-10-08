// app/api/it/issues/[id]/route.ts
//
// PATCH — IT moves an issue along:
//   reported  — send a DRAFT to the roles it's routed to, for any issue (IT is
//               the super-admin; e.g. a Store Closing On Hold draft its store
//               never sent). Notifies those roles like the reporter's "Send".
//   in_review — IT starts working it (only issues routed to IT; any time
//               from "reported").
//   completed — IT gives final closure (only issues routed to IT), but ONLY
//               once the reporter has already marked the issue "solved"
//               (employee-only, see /api/employee/issues/[id]) — never the
//               other way around. Releases a Store Closing held by it.
//
// IT sees every store — no area scoping (unlike Ops).

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { issues, userRoles, issueRoleAssignments } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';
import {
  loadIssueAssignedRoles,
  notifyIssueEvent,
  serializeIssue,
  type IssueStatus,
} from '@/lib/db/utils/issues';
import { reopenStoreClosingHoldForIssue } from '@/lib/db/utils/store-closing';

const VALID_STATUSES: IssueStatus[] = ['reported', 'in_review', 'completed'];

function isValidStatus(value: string): value is IssueStatus {
  return VALID_STATUSES.includes(value as IssueStatus);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const scope = await resolveItScope();
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
        { error: 'Invalid status. IT can only use reported, in_review or completed.' },
        { status: 400 },
      );
    }

    const [itRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'it'))
      .limit(1);

    if (!itRole) {
      return NextResponse.json({ error: 'IT role missing' }, { status: 500 });
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

    // ── Send a draft on the reporter's behalf ──────────────────────────────
    if (requestedStatus === 'reported') {
      if (target.status !== 'draft') {
        return NextResponse.json({ error: 'Only a draft issue can be sent.' }, { status: 409 });
      }

      const [sent] = await db
        .update(issues)
        .set({ status: 'reported', updatedAt: new Date() })
        .where(and(eq(issues.id, issueId), eq(issues.status, 'draft')))
        .returning();
      if (!sent) {
        return NextResponse.json({ error: 'This issue was just changed. Refresh and try again.' }, { status: 409 });
      }

      const roles = (await loadIssueAssignedRoles([issueId])).get(issueId) ?? [];
      await notifyIssueEvent({
        issueId,
        storeId: sent.storeId,
        assignedRoles: roles,
        type: 'issue_reported',
        title: `New issue: ${sent.title}`,
        body: 'An issue was reported and routed to your team.',
        excludeUserId: scope.userId,
      });

      return NextResponse.json({ success: true, issue: serializeIssue(sent, roles) });
    }

    if (target.status === 'draft') {
      return NextResponse.json(
        { error: 'This issue is still a draft. Send it first.' },
        { status: 409 },
      );
    }

    if (requestedStatus === 'completed' && target.status !== 'solved') {
      return NextResponse.json(
        { error: 'This issue must be resolved by the reporter before it can be marked complete.' },
        { status: 409 },
      );
    }

    const [itAssignment] = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(
        and(
          eq(issueRoleAssignments.issueId, issueId),
          eq(issueRoleAssignments.roleId, itRole.id),
        ),
      )
      .limit(1);

    const routedToIT = !!itAssignment || target.assignedToRoleId === itRole.id;

    if (!routedToIT) {
      return NextResponse.json(
        { error: 'This issue is not routed to IT.' },
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
      // Same as Ops completing it: a Store Closing held by this issue reopens.
      await reopenStoreClosingHoldForIssue(issueId);

      await notifyIssueEvent({
        issueId,
        storeId: target.storeId,
        assignedRoles,
        type: 'issue_completed',
        title: `Issue completed: ${updated.title}`,
        body: 'IT confirmed the resolution. Issue closed.',
        excludeUserId: scope.userId,
      });
    }

    return NextResponse.json({
      success: true,
      issue: serializeIssue(updated, assignedRoles),
    });
  } catch (err) {
    console.error('[PATCH /api/it/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
