// app/api/employee/issues/route.ts
//
// GET  — list issues visible to the current employee's store.
//        Draft issues stay private to the reporter.
//        Reported / in_review / resolved issues are visible to every employee
//        assigned to the same store.
// POST — create a new issue routed to one or more roles/departments.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, desc, eq, ne, or } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, users } from '@/lib/db/schema';
import {
  computeIssuePermissionFlags,
  createIssueWithRoles,
  loadIssueAssignedRoles,
  notifyIssueEvent,
  serializeIssue,
  type IssueStatus,
} from '@/lib/db/utils/issues';

const ISSUE_STATUSES = new Set<IssueStatus>(['draft', 'reported', 'in_review', 'completed', 'solved']);
const EMPLOYEE_CREATABLE_STATUSES = new Set<IssueStatus>(['draft', 'reported']);

function cleanRoleIds(value: unknown, fallback?: unknown): number[] {
  const raw = Array.isArray(value) ? value : fallback == null ? [] : [fallback];

  return [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ];
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const rawStatus = new URL(req.url).searchParams.get('status') as IssueStatus | null;
  const status = rawStatus && ISSUE_STATUSES.has(rawStatus) ? rawStatus : undefined;

  const [me] = await db
    .select({ id: users.id, homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!me?.homeStoreId) {
    return NextResponse.json({ success: true, issues: [] });
  }

  const conditions = [
    eq(issues.storeId, me.homeStoreId),

    // Visibility rule:
    // - own issues are always visible, including draft
    // - other employee issues in the same store are visible only after draft
    or(
      eq(issues.userId, userId),
      ne(issues.status, 'draft'),
    )!,
  ];

  if (status) {
    conditions.push(eq(issues.status, status));
  }

  const rows = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt));

  const roleMap = await loadIssueAssignedRoles(rows.map((row) => row.id));

  const out = rows.map((row) => ({
    ...serializeIssue(row, roleMap.get(row.id) ?? []),
    ...computeIssuePermissionFlags(row, userId),
  }));

  return NextResponse.json({ success: true, issues: out });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const body = await req.json().catch(() => ({}));

  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const attachmentUrls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls : [];
  const assignedToRoleIds = cleanRoleIds(body.assignedToRoleIds, body.assignedToRoleId);
  const requestedStatus = String(body.status ?? 'reported') as IssueStatus;

  if (!EMPLOYEE_CREATABLE_STATUSES.has(requestedStatus)) {
    return NextResponse.json(
      { error: 'Employee issues can only be created as draft or reported.' },
      { status: 400 },
    );
  }

  if (title.length < 3) {
    return NextResponse.json(
      { error: 'Title must be at least 3 characters.' },
      { status: 400 },
    );
  }

  if (description.length < 10) {
    return NextResponse.json(
      { error: 'Please describe the issue in more detail.' },
      { status: 400 },
    );
  }

  if (!assignedToRoleIds.length) {
    return NextResponse.json(
      { error: 'Please choose who to send this to.' },
      { status: 400 },
    );
  }

  // Reporter's store comes from their profile — never trust storeId from client.
  const [me] = await db
    .select({ id: users.id, homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!me?.homeStoreId) {
    return NextResponse.json(
      { error: 'Your account has no assigned store. Contact an admin.' },
      { status: 400 },
    );
  }

  try {
    const issue = await createIssueWithRoles({
      title,
      description,
      userId: me.id,
      storeId: me.homeStoreId,
      assignedToRoleIds,
      status: requestedStatus,
      attachmentUrls,
    });

    if (issue.status === 'reported') {
      await notifyIssueEvent({
        issueId: Number(issue.id),
        storeId: me.homeStoreId,
        assignedRoles: issue.assignedToRoles,
        type: 'issue_reported',
        title: `New issue: ${issue.title}`,
        body: `An issue was reported and routed to your team.`,
        excludeUserId: me.id,
      });
    }

    return NextResponse.json({ success: true, issue });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit issue.' },
      { status: 400 },
    );
  }
}
