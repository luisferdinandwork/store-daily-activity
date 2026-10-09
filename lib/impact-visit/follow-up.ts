import { addDaysKey, jakartaDateKey, jakartaDayStart } from "@/lib/day-bucket";

export const FOLLOW_UP_STATUSES = [
  "needs_fix",
  "not_done",
  "verified",
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
/**
 * What Ops can record in "Catat pemeriksaan": fixed or not. `not_done` stays in
 * the DB enum for checks saved before this was simplified; it reads (and
 * counts) as "Belum diperbaiki" and is never offered again.
 */
export const FOLLOW_UP_CHOICES = ["needs_fix", "verified"] as const;
export const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = {
  needs_fix: "Belum diperbaiki",
  not_done: "Belum diperbaiki",
  verified: "Sudah diperbaiki",
};
/** The choice a stored status shows as in the form. */
export function followUpChoice(status: FollowUpStatus): (typeof FOLLOW_UP_CHOICES)[number] {
  return status === "verified" ? "verified" : "needs_fix";
}
export interface FollowUpCheck {
  id: number;
  itemId: string;
  status: FollowUpStatus;
  note: string | null;
  checkedAt: string;
  reviewerName: string | null;
}
export interface FollowUpSummary {
  total: number;
  needsFix: number;
  notDone: number;
  verified: number;
  dueThisWeek: number;
  lastCheckedAt: string | null;
}

/** Monday 00:00 Jakarta. Never depends on the browser/server timezone. */
export function followUpWeekStart(now: Date | string = new Date()): Date {
  const day = jakartaDateKey(now);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return jakartaDayStart(addDaysKey(day, -((weekday + 6) % 7)));
}

export function followUpSummary(
  itemIds: string[],
  checks: FollowUpCheck[],
  now = new Date(),
): FollowUpSummary {
  const latest = new Map<string, FollowUpCheck>();
  for (const check of checks) {
    const previous = latest.get(check.itemId);
    if (
      !previous ||
      check.checkedAt > previous.checkedAt ||
      (check.checkedAt === previous.checkedAt && check.id > previous.id)
    )
      latest.set(check.itemId, check);
  }
  const result: FollowUpSummary = {
    total: itemIds.length,
    needsFix: 0,
    notDone: 0,
    verified: 0,
    dueThisWeek: 0,
    lastCheckedAt: null,
  };
  const weekStart = followUpWeekStart(now).getTime();
  for (const id of itemIds) {
    const check = latest.get(id);
    const status = check?.status ?? "needs_fix";
    if (status === "verified") result.verified++;
    else {
      if (status === "needs_fix") result.needsFix++;
      else result.notDone++;
      if (!check || new Date(check.checkedAt).getTime() < weekStart)
        result.dueThisWeek++;
    }
    if (
      check &&
      (!result.lastCheckedAt || check.checkedAt > result.lastCheckedAt)
    )
      result.lastCheckedAt = check.checkedAt;
  }
  return result;
}

export function followUpPermissions(
  visit: { status: string; visitedBy: string; storeAreaId: number | null },
  actor: { userId: string; scope: "area" | "all_areas"; areaId: number | null },
) {
  const owns = visit.visitedBy === actor.userId;
  const canView =
    visit.status === "submitted" &&
    (actor.scope === "all_areas" ||
      (owns && visit.storeAreaId === actor.areaId));
  return { canView, canReview: canView && owns };
}

export function parseFollowUpInput(
  body: unknown,
): { itemId: string; status: FollowUpStatus; note: string | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { itemId, status, note } = body as Record<string, unknown>;
  if (typeof itemId !== "string" || !/^(main|vm)-\d+$/.test(itemId))
    return null;
  if (!FOLLOW_UP_STATUSES.includes(status as FollowUpStatus)) return null;
  if (note != null && (typeof note !== "string" || note.length > 2000))
    return null;
  return {
    itemId,
    status: status as FollowUpStatus,
    note: typeof note === "string" ? note.trim() || null : null,
  };
}
