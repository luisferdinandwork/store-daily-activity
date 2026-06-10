// app/api/employee/issues/[id]/route.ts
//
// Employee flow:
// - draft can be edited by the reporter only
// - draft can be sent to OPS by changing status draft -> reported
// - reported / in_review / resolved are read-only for store employees
// - managers can advance reported / in_review / resolved

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  loadIssueAssignedRoles,
  replaceIssueRoleAssignments,
  serializeIssue,
  validateAssignableRoleIds,
  type IssueStatus,
} from '@/lib/db/utils/issues';
import { reopenStoreClosingHoldForIssue } from '@/lib/db/utils/store-closing';

const issueStatusValues = ['draft', 'reported', 'in_review', 'resolved'] as const;

const patchSchema = z.object({
  status: z.enum(issueStatusValues).optional(),
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(2000).optional(),
  attachmentUrls: z.array(z.string()).optional(),

  // Multi-role support.
  assignedToRoleIds: z.array(z.coerce.number().int().positive()).min(1).optional(),

  // Backward-compatible fallback.
  assignedToRoleId: z.coerce.number().int().positive().optional(),
});

function isIssueManager(user: { role?: string; employeeType?: string | null }) {
  return ['ops', 'admin', 'finance', 'it'].includes(user.role ?? '') ||
    ['ops_area', 'ops_ho'].includes(user.employeeType ?? '');
}

function cleanRoleIds(parsed: z.infer<typeof patchSchema>): number[] | undefined {
  const raw = parsed.assignedToRoleIds ?? (parsed.assignedToRoleId ? [parsed.assignedToRoleId] : undefined);
  if (!raw) return undefined;
  return [...new Set(raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const issueId = Number(id);

    if (!Number.isInteger(issueId) || issueId <= 0) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role?: string; employeeType?: string | null };

    const [existing] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      );
    }

    const manager = isIssueManager(user);
    const ownsIssue = existing.userId === user.id;
    const roleIds = cleanRoleIds(parsed.data);

    if (!manager && !ownsIssue) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const wantsToSendDraft = existing.status === 'draft' && parsed.data.status === 'reported';
    const wantsToEditContent =
      parsed.data.title !== undefined ||
      parsed.data.description !== undefined ||
      parsed.data.attachmentUrls !== undefined ||
      roleIds !== undefined;

    if (!manager) {
      if (wantsToEditContent && existing.status !== 'draft') {
        return NextResponse.json(
          { error: 'Only draft issues can be edited before sending to OPS.' },
          { status: 409 },
        );
      }

      if (parsed.data.status && parsed.data.status !== existing.status && !wantsToSendDraft) {
        return NextResponse.json(
          { error: 'Employees can only send a draft issue to OPS.' },
          { status: 403 },
        );
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.attachmentUrls !== undefined) updates.attachmentUrls = JSON.stringify(parsed.data.attachmentUrls);

    let assignedRoles: Awaited<ReturnType<typeof validateAssignableRoleIds>> | null = null;

    if (roleIds) {
      if (!ownsIssue && !manager) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      assignedRoles = await validateAssignableRoleIds(roleIds);
      if (assignedRoles.length !== roleIds.length) {
        return NextResponse.json({ error: 'One or more selected destinations are invalid.' }, { status: 400 });
      }

      // Keep old single-column fallback synced for old pages and reports.
      updates.assignedToRoleId = assignedRoles[0]?.id ?? null;
    }

    if (parsed.data.status) {
      if (manager) {
        if (parsed.data.status === 'draft') {
          return NextResponse.json(
            { error: 'Managers cannot move an issue back to draft.' },
            { status: 400 },
          );
        }

        updates.status = parsed.data.status;
        updates.reviewedBy = user.id;
        updates.reviewedAt = existing.reviewedAt ?? new Date();
      } else if (wantsToSendDraft) {
        updates.status = 'reported';
      }
    }

    const [updated] = await db
      .update(issues)
      .set(updates)
      .where(eq(issues.id, issueId))
      .returning();

    if (roleIds && assignedRoles) {
      await replaceIssueRoleAssignments(issueId, assignedRoles.map((role) => role.id));
    }

    if (parsed.data.status === 'resolved') {
      await reopenStoreClosingHoldForIssue(issueId);
    }

    const finalRoles = assignedRoles ?? ((await loadIssueAssignedRoles([issueId])).get(issueId) ?? []);
    const serialized = serializeIssue(updated, finalRoles);
    const isOwner = updated.userId === user.id;
    const isDraft = updated.status === 'draft';

    return NextResponse.json({
      success: true,
      issue: {
        ...serialized,
        isOwner,
        canEdit: isOwner && isDraft,
        canDelete: isOwner && isDraft,
        canSendToOps: isOwner && isDraft,
      },
    });
  } catch (err) {
    console.error('[PATCH /api/employee/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const issueId = Number(id);

    if (!Number.isInteger(issueId) || issueId <= 0) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role?: string };

    const [existing] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    const isAdmin = user.role === 'admin';
    if (existing.userId !== user.id && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isAdmin && existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft issues can be deleted by store employees.' },
        { status: 409 },
      );
    }

    await db.delete(issues).where(eq(issues.id, issueId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/employee/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
