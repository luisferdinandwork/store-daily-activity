// app/api/finance/dashboard/route.ts
//
// Returns summary counts for the Finance dashboard:
//   pendingPettyCash     — petty_cash_transactions not yet approved (approvedAt IS NULL)
//   pendingDailyReports  — daily_reports with status = 'submitted' (awaiting Finance verification)
//   openIssues           — issues routed to the Finance role that are not yet resolved
//
// Access: finance role only (checked via resolveFinanceScope).

import { NextResponse } from 'next/server';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveFinanceScope } from '@/lib/finance/scope';
import {
  dailyReports,
  issues,
  issueRoleAssignments,
} from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema';
import { userRoles } from '@/lib/db/schema/lookups';

export type FinanceDashboardData = {
  pendingPettyCash: number;
  pendingDailyReports: number;
  openIssues: number;
};

export type FinanceDashboardResponse =
  | { success: true; data: FinanceDashboardData }
  | { success: false; error: string };

export async function GET(): Promise<NextResponse<FinanceDashboardResponse>> {
  const scope = await resolveFinanceScope();
  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  // 1. Pending petty-cash transactions (no approvedAt set yet)
  const [pettyCashRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pettyCashTransactions)
    .where(isNull(pettyCashTransactions.approvedAt));

  // 2. Daily reports pending Finance verification
  const [reportsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dailyReports)
    .where(eq(dailyReports.status, 'submitted'));

  // 3. Open issues routed to Finance role (not resolved/draft)
  //    Join issueRoleAssignments to find issues where Finance role is a target.
  const [financeRoleRow] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.code, 'finance'))
    .limit(1);

  let openIssueCount = 0;

  if (financeRoleRow) {
    // Issues routed to Finance via issueRoleAssignments
    const financeIssueIds = await db
      .select({ issueId: issueRoleAssignments.issueId })
      .from(issueRoleAssignments)
      .where(eq(issueRoleAssignments.roleId, financeRoleRow.id));

    if (financeIssueIds.length > 0) {
      const ids = financeIssueIds.map((r) => r.issueId);
      const [issuesRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            inArray(issues.id, ids),
            inArray(issues.status, ['reported', 'in_review', 'completed']),
          ),
        );
      openIssueCount = issuesRow?.count ?? 0;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      pendingPettyCash:    pettyCashRow?.count ?? 0,
      pendingDailyReports: reportsRow?.count   ?? 0,
      openIssues:          openIssueCount,
    },
  });
}