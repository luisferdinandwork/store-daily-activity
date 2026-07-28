// app/api/ops/impact-visits/[id]/route.ts
//
// GET    — single visit detail (area-scoped).
// PATCH  — update while status='draft' only. Scores are recomputed
//          server-side whenever checklistResponses/vmChecklistResponses are
//          touched, so the client never has to (and can't) fake a score.
//          Setting status:'submitted' locks the visit — no further edits.
// DELETE — draft only.
//
// Editing rights: the visit's own creator (visitedBy), or any ops_ho/admin
// via resolveOpsScope()'s 'all_areas' scope. An ops_area user outside the
// visit's store area is rejected entirely (area scoping); one inside the
// area but who isn't the creator can view but not edit/delete.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  computeImpactVisitPermissionFlags,
  scoreMainChecklist,
  scoreVmChecklist,
  serializeImpactVisit,
} from '@/lib/db/utils/impact-visits';
import type { ChecklistResponses } from '@/lib/impact-visit/scoring';
import type { CashMoneyData } from '@/lib/impact-visit/checklist-config';

async function loadVisitWithStoreArea(id: number) {
  const [row] = await db
    .select({
      visit: impactVisits,
      storeAreaId: stores.areaId,
      storeName: stores.name,
      storeNo: stores.storeNo,
      areaName: areas.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(eq(impactVisits.id, id))
    .limit(1);
  return row ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const found = await loadVisitWithStoreArea(visitId);
  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  const isHO = scope.scope === 'all_areas';

  return NextResponse.json({
    success: true,
    visit: {
      ...serializeImpactVisit(found.visit),
      ...computeImpactVisitPermissionFlags(found.visit, { userId: scope.userId, isHO }),
      store: { name: found.storeName, storeNo: found.storeNo },
      areaName: found.areaName,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const found = await loadVisitWithStoreArea(visitId);
  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  const isHO = scope.scope === 'all_areas';
  const { canEdit } = computeImpactVisitPermissionFlags(found.visit, { userId: scope.userId, isHO });

  if (!canEdit) {
    return NextResponse.json(
      { success: false, error: found.visit.status !== 'draft' ? 'This visit has already been submitted.' : 'Forbidden' },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.checklistResponses !== undefined) {
    const responses = body.checklistResponses as ChecklistResponses;
    const result = scoreMainChecklist(responses);
    updates.checklistResponses = JSON.stringify(responses);
    updates.checklistScore = result.score;
    updates.checklistGrade = result.grade;
  }

  if (body.vmChecklistResponses !== undefined) {
    const responses = body.vmChecklistResponses as ChecklistResponses;
    const result = scoreVmChecklist(responses);
    updates.vmChecklistResponses = JSON.stringify(responses);
    updates.vmChecklistScore = result.score;
    updates.vmChecklistGrade = result.grade;
  }

  if (body.cashMoneyData !== undefined) {
    updates.cashMoneyData = JSON.stringify(body.cashMoneyData as CashMoneyData);
  }

  if (typeof body.targetBulanBerjalan === 'string' || body.targetBulanBerjalan === null) {
    updates.targetBulanBerjalan = body.targetBulanBerjalan;
  }
  if (typeof body.periodeTanggal === 'string' || body.periodeTanggal === null) {
    updates.periodeTanggal = body.periodeTanggal;
  }
  if (body.pencapaianPct !== undefined) {
    updates.pencapaianPct = body.pencapaianPct === null ? null : String(body.pencapaianPct);
  }
  if (typeof body.notes === 'string' || body.notes === null) {
    updates.notes = body.notes;
  }
  if (body.visitDate) {
    updates.visitDate = new Date(body.visitDate);
  }

  if (body.status === 'submitted') {
    updates.status = 'submitted';
  }

  const [updated] = await db
    .update(impactVisits)
    .set(updates)
    .where(eq(impactVisits.id, visitId))
    .returning();

  return NextResponse.json({
    success: true,
    visit: {
      ...serializeImpactVisit(updated),
      ...computeImpactVisitPermissionFlags(updated, { userId: scope.userId, isHO }),
      store: { name: found.storeName, storeNo: found.storeNo },
      areaName: found.areaName,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const found = await loadVisitWithStoreArea(visitId);
  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  const isHO = scope.scope === 'all_areas';
  const { canDelete } = computeImpactVisitPermissionFlags(found.visit, { userId: scope.userId, isHO });

  if (!canDelete) {
    return NextResponse.json({ success: false, error: 'Only a draft visit can be deleted.' }, { status: 409 });
  }

  await db.delete(impactVisits).where(eq(impactVisits.id, visitId));
  return NextResponse.json({ success: true });
}
