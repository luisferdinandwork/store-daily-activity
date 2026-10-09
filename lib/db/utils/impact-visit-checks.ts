import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { impactVisitChecks, users } from "@/lib/db/schema";
import type { FollowUpCheck } from "@/lib/impact-visit/follow-up";

/** Latest check per point, batched across visits; full timeline for one detail. */
export async function loadImpactChecks(
  visitIds: number[],
  history = false,
): Promise<Map<number, FollowUpCheck[]>> {
  const out = new Map<number, FollowUpCheck[]>();
  if (!visitIds.length) return out;
  const fields = { check: impactVisitChecks, reviewerName: users.name };
  const query = history
    ? db.select(fields)
    : db.selectDistinctOn(
        [impactVisitChecks.visitId, impactVisitChecks.itemId],
        fields,
      );
  const rows = await query
    .from(impactVisitChecks)
    .leftJoin(users, eq(users.id, impactVisitChecks.checkedBy))
    .where(inArray(impactVisitChecks.visitId, visitIds))
    .orderBy(
      impactVisitChecks.visitId,
      impactVisitChecks.itemId,
      desc(impactVisitChecks.checkedAt),
      desc(impactVisitChecks.id),
    );
  for (const { check, reviewerName } of rows) {
    const list = out.get(check.visitId) ?? [];
    list.push({
      id: check.id,
      itemId: check.itemId,
      status: check.status,
      note: check.note,
      checkedAt: check.checkedAt.toISOString(),
      reviewerName,
    });
    out.set(check.visitId, list);
  }
  for (const list of out.values())
    list.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || b.id - a.id);
  return out;
}
