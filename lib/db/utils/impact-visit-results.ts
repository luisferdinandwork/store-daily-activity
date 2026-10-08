// lib/db/utils/impact-visit-results.ts
//
// Impact Visit results for a store's own staff (employee "Impact Visit Result").
// Read-only: SUBMITTED visits of one store only — drafts are Ops's work in
// progress and never shown. View shapes + the "tidak" filter live in
// lib/impact-visit/results.ts.

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, users, type ImpactVisit } from '@/lib/db/schema';
import { parseJson } from '@/lib/db/utils/impact-visits';
import {
  negativeMainItems,
  negativeVmItems,
  type ImpactVisitResultDetail,
  type ImpactVisitResultSummary,
} from '@/lib/impact-visit/results';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';

/** Plenty for a store's history; visits are a few a month at most. */
const LIST_LIMIT = 60;

type VisitRow = ImpactVisit & { visitedByName: string | null };

function toResult(row: VisitRow): ImpactVisitResultDetail {
  const mainNegatives = negativeMainItems(parseJson<ChecklistResponses>(row.checklistResponses, {}));
  const vmNegatives = negativeVmItems(parseJson<ChecklistResponses>(row.vmChecklistResponses, {}));

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
  };
}

function toSummary(row: VisitRow): ImpactVisitResultSummary {
  const { id, visitDate, visitType, visitedByName, main, vm } = toResult(row);
  return { id, visitDate, visitType, visitedByName, main, vm };
}

function selectVisits() {
  return db
    .select({ visit: impactVisits, visitedByName: users.name })
    .from(impactVisits)
    .leftJoin(users, eq(users.id, impactVisits.visitedBy));
}

/** A store's submitted visits, latest first. */
export async function listStoreImpactVisitResults(storeId: number): Promise<ImpactVisitResultSummary[]> {
  const rows = await selectVisits()
    .where(and(eq(impactVisits.storeId, storeId), eq(impactVisits.status, 'submitted')))
    .orderBy(desc(impactVisits.visitDate), desc(impactVisits.id))
    .limit(LIST_LIMIT);

  return rows.map((r) => toSummary({ ...r.visit, visitedByName: r.visitedByName }));
}

/** One submitted visit of `storeId` with its "tidak" items, or null (not found / other store / draft). */
export async function getStoreImpactVisitResult(
  storeId: number,
  visitId: number,
): Promise<ImpactVisitResultDetail | null> {
  const [row] = await selectVisits()
    .where(and(
      eq(impactVisits.id, visitId),
      eq(impactVisits.storeId, storeId),
      eq(impactVisits.status, 'submitted'),
    ))
    .limit(1);

  return row ? toResult({ ...row.visit, visitedByName: row.visitedByName }) : null;
}
