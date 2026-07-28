// app/api/ops/issues/route.ts
//
// GET — issues routed to the Ops role that the current Ops user may follow up.
//
// Rules:
// - ops_ho/admin sees every Ops-routed issue.
// - ops_area sees only Ops-routed issues from stores in their assigned area.
// - draft issues are hidden from OPS.
// - Multi-role routing uses issue_role_assignments.
// - assignedToRoleId remains as backward-compatible fallback.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  issues,
  stores,
  areas,
  users,
  userRoles,
  employeeTypes,
  issueRoleAssignments,
} from '@/lib/db/schema';
import { loadIssueAssignedRoles } from '@/lib/db/utils/issues';

function parseUrls(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as string[];

  try {
    const parsed = JSON.parse(value as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    if (!actor || (actor.roleCode !== 'ops' && actor.roleCode !== 'it')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isHO = actor.empType === 'ops_ho' || actor.roleCode === 'it';

    const [opsRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'ops'))
      .limit(1);

    if (!opsRole) {
      return NextResponse.json({ error: 'Ops role missing' }, { status: 500 });
    }

    const assignedRows = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(eq(issueRoleAssignments.roleId, opsRole.id));

    const assignedIssueIds = [
      ...new Set(
        assignedRows
          .map((row) => row.issueId)
          .filter((id): id is number => Number.isFinite(id)),
      ),
    ];

    const opsRoutingConditions = [eq(issues.assignedToRoleId, opsRole.id)];

    if (assignedIssueIds.length) {
      opsRoutingConditions.push(inArray(issues.id, assignedIssueIds));
    }

    const conditions = [
      ne(issues.status, 'draft'),
      or(...opsRoutingConditions)!,
    ];

    if (!isHO) {
      if (actor.areaId == null) {
        return NextResponse.json({ success: true, isHO, area: null, issues: [] });
      }

      conditions.push(eq(stores.areaId, actor.areaId));
    }

    const rows = await db
      .select({
        id: issues.id,
        title: issues.title,
        description: issues.description,
        status: issues.status,
        attachmentUrls: issues.attachmentUrls,
        baAttachmentUrls: issues.baAttachmentUrls,
        baUploadedAt: issues.baUploadedAt,
        solvedAt: issues.solvedAt,
        reviewedAt: issues.reviewedAt,
        reviewedBy: issues.reviewedBy,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,

        storeId: stores.id,
        storeName: stores.name,
        areaId: areas.id,
        areaName: areas.name,

        reporterId: users.id,
        reporterName: users.name,
        reporterNik: users.nik,
      })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .innerJoin(areas, eq(stores.areaId, areas.id))
      .innerJoin(users, eq(issues.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(issues.createdAt));

    const roleMap = await loadIssueAssignedRoles(rows.map((row) => row.id));

    const out = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      description: row.description,
      status: row.status,
      attachmentUrls: parseUrls(row.attachmentUrls),
      baAttachmentUrls: parseUrls(row.baAttachmentUrls),
      baUploadedAt: row.baUploadedAt,
      solvedAt: row.solvedAt,
      reviewedAt: row.reviewedAt,
      reviewedBy: row.reviewedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assignedToRoles: roleMap.get(row.id) ?? [],
      store: {
        id: String(row.storeId),
        name: row.storeName,
        areaId: row.areaId == null ? null : String(row.areaId),
        areaName: row.areaName,
      },
      reporter: {
        id: row.reporterId,
        name: row.reporterName,
        nik: row.reporterNik,
      },
    }));

    const area = !isHO && rows[0]
      ? { id: String(rows[0].areaId), name: rows[0].areaName }
      : null;

    return NextResponse.json({ success: true, isHO, area, issues: out });
  } catch (err) {
    console.error('[GET /api/ops/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
