// app/api/finance/issues/route.ts
//
// GET — issues routed to the Finance role. Finance sees every store (no area
// scoping, unlike Ops) — mirrors app/api/ops/issues/route.ts's shape/query,
// just routed by the 'finance' role instead of 'ops', with no area filter.

import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { issues, stores, areas, users, userRoles, issueRoleAssignments } from '@/lib/db/schema';
import { resolveFinanceScope } from '@/lib/finance/scope';
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
    const scope = await resolveFinanceScope();
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const [financeRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'finance'))
      .limit(1);

    if (!financeRole) {
      return NextResponse.json({ error: 'Finance role missing' }, { status: 500 });
    }

    const assignedRows = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(eq(issueRoleAssignments.roleId, financeRole.id));

    const assignedIssueIds = [
      ...new Set(
        assignedRows
          .map((row) => row.issueId)
          .filter((id): id is number => Number.isFinite(id)),
      ),
    ];

    const routingConditions = [eq(issues.assignedToRoleId, financeRole.id)];
    if (assignedIssueIds.length) {
      routingConditions.push(inArray(issues.id, assignedIssueIds));
    }

    const conditions = [ne(issues.status, 'draft'), or(...routingConditions)!];

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

    return NextResponse.json({ success: true, issues: out });
  } catch (err) {
    console.error('[GET /api/finance/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
