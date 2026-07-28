// lib/db/utils/impact-visits.ts
//
// Server-side helpers for the Impact Visit feature (see
// lib/db/schema/impact-visits.ts for the data model and
// lib/impact-visit/checklist-config.ts for the static checklist content).

import { db } from '@/lib/db';
import { impactVisits, type ImpactVisit } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  IMPACT_CHECKLIST,
  VM_CHECKLIST,
  emptyCashMoneyData,
  type CashMoneyData,
} from '@/lib/impact-visit/checklist-config';
import {
  scoreChecklist,
  IMPACT_CHECKLIST_PASS_THRESHOLD,
  VM_CHECKLIST_PASS_THRESHOLD,
  type ChecklistResponses,
} from '@/lib/impact-visit/scoring';

export function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface SerializedImpactVisit {
  id: string;
  storeId: string;
  visitedBy: string;
  visitDate: string;

  targetBulanBerjalan: string | null;
  periodeTanggal: string | null;
  pencapaianPct: string | null;

  checklistResponses: ChecklistResponses;
  checklistScore: number;
  checklistMaxScore: number;
  checklistGrade: string | null;

  cashMoneyData: CashMoneyData;

  vmChecklistResponses: ChecklistResponses;
  vmChecklistScore: number;
  vmChecklistMaxScore: number;
  vmChecklistGrade: string | null;

  notes: string | null;
  status: 'draft' | 'submitted';

  createdAt: string;
  updatedAt: string;
}

export function serializeImpactVisit(row: ImpactVisit): SerializedImpactVisit {
  return {
    id: String(row.id),
    storeId: String(row.storeId),
    visitedBy: row.visitedBy,
    visitDate: row.visitDate.toISOString(),

    targetBulanBerjalan: row.targetBulanBerjalan,
    periodeTanggal: row.periodeTanggal,
    pencapaianPct: row.pencapaianPct,

    checklistResponses: parseJson<ChecklistResponses>(row.checklistResponses, {}),
    checklistScore: row.checklistScore,
    checklistMaxScore: row.checklistMaxScore,
    checklistGrade: row.checklistGrade,

    cashMoneyData: parseJson<CashMoneyData>(row.cashMoneyData, emptyCashMoneyData()),

    vmChecklistResponses: parseJson<ChecklistResponses>(row.vmChecklistResponses, {}),
    vmChecklistScore: row.vmChecklistScore,
    vmChecklistMaxScore: row.vmChecklistMaxScore,
    vmChecklistGrade: row.vmChecklistGrade,

    notes: row.notes,
    status: row.status as 'draft' | 'submitted',

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ImpactVisitPermissionFlags {
  canEdit: boolean;
  canDelete: boolean;
}

export function computeImpactVisitPermissionFlags(
  visit: Pick<ImpactVisit, 'status' | 'visitedBy'>,
  actor: { userId: string; isHO: boolean },
): ImpactVisitPermissionFlags {
  const isDraft = visit.status === 'draft';
  const owns = visit.visitedBy === actor.userId;
  const canManage = actor.isHO || owns;

  return {
    canEdit: isDraft && canManage,
    canDelete: isDraft && canManage,
  };
}

/** Recomputes checklistScore/Grade from responses — used on every PATCH that touches answers. */
export function scoreMainChecklist(responses: ChecklistResponses) {
  return scoreChecklist(IMPACT_CHECKLIST, responses, IMPACT_CHECKLIST_PASS_THRESHOLD);
}

/** Recomputes vmChecklistScore/Grade from responses — used on every PATCH that touches answers. */
export function scoreVmChecklist(responses: ChecklistResponses) {
  return scoreChecklist(VM_CHECKLIST, responses, VM_CHECKLIST_PASS_THRESHOLD);
}

export async function getImpactVisitById(id: number): Promise<ImpactVisit | null> {
  const [row] = await db.select().from(impactVisits).where(eq(impactVisits.id, id)).limit(1);
  return row ?? null;
}
