// app/api/it/issues/route.ts
//
// GET — EVERY issue, whoever it's routed to and whatever its status, drafts
// included. IT is the super-admin and the one who can spot an issue stuck
// somewhere (e.g. a Store Closing On Hold draft nobody sent). `routedToIt`
// tells the page which ones IT may also act on (/api/it/issues/[id]).

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import { issues, stores, areas, users, userRoles } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';
import {
  getStoreClosingHoldIssueIds,
  loadIssueAssignedRoles,
  parseAttachmentUrls,
} from '@/lib/db/utils/issues';

export async function GET() {
  try {
    const scope = await resolveItScope();
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const [itRole] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.code, 'it'))
      .limit(1);

    const reviewer = alias(users, 'reviewer');

    const rows = await db
      .select({
        id: issues.id,
        title: issues.title,
        description: issues.description,
        status: issues.status,
        assignedToRoleId: issues.assignedToRoleId,
        attachmentUrls: issues.attachmentUrls,
        baAttachmentUrls: issues.baAttachmentUrls,
        baUploadedAt: issues.baUploadedAt,
        solvedAt: issues.solvedAt,
        reviewedAt: issues.reviewedAt,
        reviewedByName: reviewer.name,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,

        storeId: stores.id,
        storeNo: stores.storeNo,
        storeName: stores.name,
        areaId: areas.id,
        areaName: areas.name,

        reporterId: users.id,
        reporterName: users.name,
        reporterNik: users.nik,
      })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .leftJoin(areas, eq(stores.areaId, areas.id))
      .innerJoin(users, eq(issues.userId, users.id))
      .leftJoin(reviewer, eq(reviewer.id, issues.reviewedBy))
      .orderBy(desc(issues.createdAt));

    const ids = rows.map((row) => row.id);
    const [roleMap, holdIds] = await Promise.all([
      loadIssueAssignedRoles(ids),
      getStoreClosingHoldIssueIds(ids),
    ]);

    const out = rows.map((row) => {
      const assignedToRoles = roleMap.get(row.id) ?? [];
      return {
        id: String(row.id),
        title: row.title,
        description: row.description,
        status: row.status,
        attachmentUrls: parseAttachmentUrls(row.attachmentUrls),
        baAttachmentUrls: parseAttachmentUrls(row.baAttachmentUrls),
        baUploadedAt: row.baUploadedAt,
        solvedAt: row.solvedAt,
        reviewedAt: row.reviewedAt,
        reviewedByName: row.reviewedByName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        assignedToRoles,
        routedToIt: !!itRole && (
          row.assignedToRoleId === itRole.id || assignedToRoles.some((r) => r.id === itRole.id)
        ),
        isStoreClosingHold: holdIds.has(row.id),
        store: {
          id: String(row.storeId),
          storeNo: row.storeNo,
          name: row.storeName,
          areaId: row.areaId == null ? null : String(row.areaId),
          areaName: row.areaName,
        },
        reporter: {
          id: row.reporterId,
          name: row.reporterName,
          nik: row.reporterNik,
        },
      };
    });

    return NextResponse.json({ success: true, issues: out });
  } catch (err) {
    console.error('[GET /api/it/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
