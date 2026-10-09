// lib/db/utils/impact-visit-results.ts
//
// Impact Visit results for a store's own staff (employee "Impact Visit Result")
// and for the Ops visitor's history panel. Read-only: SUBMITTED visits of one
// store only — drafts are Ops's work in progress and never shown. View shapes +
// the "tidak" filter live in lib/impact-visit/results.ts.

import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, users, type ImpactVisit } from '@/lib/db/schema';
import { parseJson } from '@/lib/db/utils/impact-visits';
import {
  EMPLOYEE_VISIBLE_VISITS,
  OPS_HISTORY_VISITS,
  negativeMainItems,
  negativeVmItems,
  type ImpactVisitResultDetail,
  type ImpactVisitResultSummary,
} from '@/lib/impact-visit/results';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';
import { followUpSummary, type FollowUpCheck } from '@/lib/impact-visit/follow-up';
import { loadImpactChecks } from './impact-visit-checks';

type VisitRow = ImpactVisit & { visitedByName: string | null };

export function toImpactVisitResult(row: VisitRow, checks: FollowUpCheck[] = []): ImpactVisitResultDetail {
  const mainNegatives = negativeMainItems(parseJson<ChecklistResponses>(row.checklistResponses, {}));
  const vmNegatives = negativeVmItems(parseJson<ChecklistResponses>(row.vmChecklistResponses, {}));
  for (const item of [...mainNegatives, ...vmNegatives]) item.followUp = checks.find((c) => c.itemId === item.id);

  return {
    id: String(row.id),
    visitDate: row.visitDate.toISOString(),
    visitType: row.visitType,
    visitedByName: row.visitedByName,
    main: {
      score: row.checklistScore,
      maxScore: row.checklistMaxScore,
      grade: row.checklistGrade,
      negativeCount: mainNegatives.length,
    },
    vm: {
      score: row.vmChecklistScore,
      maxScore: row.vmChecklistMaxScore,
      grade: row.vmChecklistGrade,
      negativeCount: vmNegatives.length,
    },
    notes: row.notes?.trim() || null,
    mainNegatives,
    vmNegatives,
    checks,
    followUp: followUpSummary([...mainNegatives, ...vmNegatives].map((i) => i.id), checks),
  };
}

function toSummary(row: VisitRow, checks: FollowUpCheck[]): ImpactVisitResultSummary {
  const { id, visitDate, visitType, visitedByName, main, vm, followUp } = toImpactVisitResult(row, checks);
  return { id, visitDate, visitType, visitedByName, main, vm, followUp };
}

function selectVisits() {
  return db
    .select({ visit: impactVisits, visitedByName: users.name })
    .from(impactVisits)
    .leftJoin(users, eq(users.id, impactVisits.visitedBy));
}

const latestFirst = [desc(impactVisits.visitDate), desc(impactVisits.id)] as const;

/** The store's latest submitted visits the staff may see (EMPLOYEE_VISIBLE_VISITS), latest first. */
export async function listStoreImpactVisitResults(storeId: number): Promise<ImpactVisitResultSummary[]> {
  const rows = await selectVisits()
    .where(and(eq(impactVisits.storeId, storeId), eq(impactVisits.status, 'submitted')))
    .orderBy(...latestFirst)
    .limit(EMPLOYEE_VISIBLE_VISITS);

  const checks = await loadImpactChecks(rows.map((r) => r.visit.id));
  return rows.map((r) => toSummary({ ...r.visit, visitedByName: r.visitedByName }, checks.get(r.visit.id) ?? []));
}

/**
 * One submitted visit of `storeId` with its "tidak" items, or null (not found /
 * other store / draft / older than the latest EMPLOYEE_VISIBLE_VISITS).
 */
export async function getStoreImpactVisitResult(
  storeId: number,
  visitId: number,
): Promise<ImpactVisitResultDetail | null> {
  const visible = db
    .select({ id: impactVisits.id })
    .from(impactVisits)
    .where(and(eq(impactVisits.storeId, storeId), eq(impactVisits.status, 'submitted')))
    .orderBy(...latestFirst)
    .limit(EMPLOYEE_VISIBLE_VISITS);
  // Apply the latest-three restriction within the same database snapshot as
  // the detail read, including store and submitted status from the subquery.
  const [row] = await selectVisits().where(and(eq(impactVisits.id, visitId), inArray(impactVisits.id, visible))).limit(1);
  if (!row) return null;
  const checks = await loadImpactChecks([visitId], true);
  return toImpactVisitResult({ ...row.visit, visitedByName: row.visitedByName }, checks.get(visitId));
}

/**
 * The store's submitted visits before `visit` (by visit date), latest first, each
 * with its "tidak" items — what the Ops visitor checks again on the next visit.
 */
export async function listPreviousImpactVisitResults(
  visit: Pick<ImpactVisit, 'id' | 'storeId' | 'visitDate'>,
): Promise<ImpactVisitResultDetail[]> {
  const rows = await selectVisits()
    .where(and(
      eq(impactVisits.storeId, visit.storeId),
      eq(impactVisits.status, 'submitted'),
      ne(impactVisits.id, visit.id),
      lte(impactVisits.visitDate, visit.visitDate),
    ))
    .orderBy(...latestFirst)
    .limit(OPS_HISTORY_VISITS);

  const checks = await loadImpactChecks(rows.map((r) => r.visit.id));
  return rows.map((r) => toImpactVisitResult({ ...r.visit, visitedByName: r.visitedByName }, checks.get(r.visit.id)));
}
