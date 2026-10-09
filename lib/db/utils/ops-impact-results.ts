import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  areas,
  impactVisitChecks,
  impactVisits,
  stores,
  users,
} from "@/lib/db/schema";
import type { OpsScope } from "@/lib/performance/ops-scope";
import {
  followUpPermissions,
  parseFollowUpInput,
} from "@/lib/impact-visit/follow-up";
import { toImpactVisitResult } from "./impact-visit-results";
import { loadImpactChecks } from "./impact-visit-checks";

export type ResultScope = Extract<OpsScope, { ok: true }>;
function selectResults() {
  return db
    .select({
      visit: impactVisits,
      store: { id: stores.id, name: stores.name, storeNo: stores.storeNo },
      storeAreaId: stores.areaId,
      areaName: areas.name,
      visitedByName: users.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(stores.id, impactVisits.storeId))
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .leftJoin(users, eq(users.id, impactVisits.visitedBy));
}

function scopeConditions(scope: ResultScope) {
  return and(
    eq(impactVisits.status, "submitted"),
    scope.scope === "area"
      ? and(
          eq(impactVisits.visitedBy, scope.userId),
          eq(stores.areaId, scope.areaId),
        )
      : undefined,
  );
}

export async function listOpsImpactResults(scope: ResultScope) {
  const rows = await selectResults()
    .where(scopeConditions(scope))
    .orderBy(desc(impactVisits.visitDate), desc(impactVisits.id));
  const checks = await loadImpactChecks(rows.map((r) => r.visit.id));
  return rows.map((r) => {
    const { id, visitDate, visitType, visitedByName, main, vm, followUp } =
      toImpactVisitResult(
        { ...r.visit, visitedByName: r.visitedByName },
        checks.get(r.visit.id),
      );
    return {
      id,
      visitDate,
      visitType,
      visitedByName,
      main,
      vm,
      followUp,
      visitedBy: r.visit.visitedBy,
      store: r.store,
      areaName: r.areaName,
    };
  });
}

export async function getOpsImpactResult(scope: ResultScope, id: number) {
  const [row] = await selectResults()
    .where(and(scopeConditions(scope), eq(impactVisits.id, id)))
    .limit(1);
  if (!row) return null;
  const checks = await loadImpactChecks([id], true);
  return {
    ...toImpactVisitResult(
      { ...row.visit, visitedByName: row.visitedByName },
      checks.get(id),
    ),
    visitedBy: row.visit.visitedBy,
    store: row.store,
    areaName: row.areaName,
    canReview: followUpPermissions(
      { ...row.visit, storeAreaId: row.storeAreaId },
      scope,
    ).canReview,
  };
}

export async function recordImpactCheck(
  scope: ResultScope,
  id: number,
  body: unknown,
) {
  const input = parseFollowUpInput(body);
  if (!input)
    return {
      success: false as const,
      status: 400,
      error: "Pilih status yang valid. Catatan maksimal 2.000 karakter.",
    };
  const visit = await getOpsImpactResult(scope, id);
  if (!visit)
    return {
      success: false as const,
      status: 404,
      error: "Hasil visit tidak ditemukan.",
    };
  if (!visit.canReview)
    return {
      success: false as const,
      status: 403,
      error: "Hanya pembuat visit yang dapat menyimpan pemeriksaan.",
    };
  if (
    ![...visit.mainNegatives, ...visit.vmNegatives].some(
      (i) => i.id === input.itemId,
    )
  ) {
    return {
      success: false as const,
      status: 400,
      error: "Hanya poin dengan hasil Tidak yang dapat diperiksa ulang.",
    };
  }
  // One append-only insert preserves concurrent rechecks and leaves original scores untouched.
  await db
    .insert(impactVisitChecks)
    .values({ visitId: id, ...input, checkedBy: scope.userId });
  return { success: true as const, data: await getOpsImpactResult(scope, id) };
}
