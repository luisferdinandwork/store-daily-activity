// app/api/ops/issues/summary/route.ts
//
// GET — how many issues routed to Ops are still unreviewed (status 'reported'),
// for the count badge on the mobile tab bar. Same routing + area scope as the
// Ops issue inbox and the dashboard's "Unreviewed issues".

import { NextResponse } from 'next/server';
import { and, count, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { issues, issueRoleAssignments, stores, userRoles } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const [opsRole] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.code, 'ops'))
    .limit(1);
  if (!opsRole) return NextResponse.json({ success: true, unreviewed: 0 });

  const assignedRows = await db
    .select({ issueId: issueRoleAssignments.issueId })
    .from(issueRoleAssignments)
    .where(eq(issueRoleAssignments.roleId, opsRole.id));
  const assignedIssueIds = [
    ...new Set(assignedRows.map((r) => r.issueId).filter((id): id is number => Number.isFinite(id))),
  ];

  const routing = [eq(issues.assignedToRoleId, opsRole.id)];
  if (assignedIssueIds.length) routing.push(inArray(issues.id, assignedIssueIds));

  const conditions = [eq(issues.status, 'reported'), or(...routing)!];
  if (scope.scope === 'area') conditions.push(eq(stores.areaId, scope.areaId));

  const [row] = await db
    .select({ n: count() })
    .from(issues)
    .innerJoin(stores, eq(issues.storeId, stores.id))
    .where(and(...conditions));

  return NextResponse.json({ success: true, unreviewed: Number(row?.n ?? 0) });
}
