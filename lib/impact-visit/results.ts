// lib/impact-visit/results.ts
//
// What a store's staff see of an Impact Visit (employee "Impact Visit Result"):
// only SUBMITTED visits — the latest EMPLOYEE_VISIBLE_VISITS of them — and of
// each one the items Ops answered "tidak" — the points to fix before the next
// visit — with Ops's note on each. The Ops visitor gets the same shapes for the
// store's earlier visits in a side panel while filling the next one. Pure +
// client-safe (no DB imports); app/api/employee/impact-visits and
// app/api/ops/impact-visits/[id]/history fill these shapes.

import {
  IMPACT_CHECKLIST,
  IMPACT_CHECKLIST_MAX_SCORE,
  VM_CHECKLIST,
  VM_CHECKLIST_MAX_SCORE,
  type ChecklistItem,
} from './checklist-config';
import type { ChecklistResponses } from './scoring';
import type { FollowUpCheck, FollowUpSummary } from './follow-up';

/** Store staff see only the store's latest 3 submitted visits (list + detail). */
export const EMPLOYEE_VISIBLE_VISITS = 3;

/** How many earlier visits the Ops history panel offers. */
export const OPS_HISTORY_VISITS = 6;

export interface NegativeItem {
  id: string;
  section: string;
  criteria: string;
  /** What Ops checks — the paper form's hint for the item. */
  hint: string;
  points: number;
  /** Ops's note on this item, if any. */
  note: string | null;
  followUp?: FollowUpCheck;
}

/** Items answered "tidak", in checklist order. Unanswered items are not listed. */
export function negativeItems(items: ChecklistItem[], responses: ChecklistResponses): NegativeItem[] {
  return items
    .filter((item) => responses[item.id]?.answer === 'tidak')
    .map((item) => ({
      id: item.id,
      section: item.section,
      criteria: item.criteria,
      hint: item.hint,
      points: item.points,
      note: responses[item.id]?.note?.trim() || null,
    }));
}

export function negativeMainItems(responses: ChecklistResponses): NegativeItem[] {
  return negativeItems(IMPACT_CHECKLIST, responses);
}

export function negativeVmItems(responses: ChecklistResponses): NegativeItem[] {
  return negativeItems(VM_CHECKLIST, responses);
}

/** Negative items grouped by their checklist section, sections in checklist order. */
export function groupBySection(items: NegativeItem[]): { section: string; items: NegativeItem[] }[] {
  const groups = new Map<string, NegativeItem[]>();
  for (const item of items) {
    const list = groups.get(item.section) ?? [];
    list.push(item);
    groups.set(item.section, list);
  }
  return [...groups.entries()].map(([section, list]) => ({ section, items: list }));
}

export interface ChecklistResultScore {
  score: number;
  maxScore: number;
  /** 'A' = passed the checklist's threshold, 'B' = below it. */
  grade: string | null;
  /** How many items were answered "tidak". */
  negativeCount: number;
}

/** One row of GET /api/employee/impact-visits. */
export interface ImpactVisitResultSummary {
  id: string;
  /** When the visit happened (real timestamp — read its Jakarta day). */
  visitDate: string;
  visitType: 'virtual' | 'on_location' | null;
  /** The Ops user who did the visit. */
  visitedByName: string | null;
  main: ChecklistResultScore;
  vm: ChecklistResultScore;
  followUp: FollowUpSummary;
}

/** GET /api/employee/impact-visits/[id]. */
export interface ImpactVisitResultDetail extends ImpactVisitResultSummary {
  /** Ops's general note on the visit. */
  notes: string | null;
  mainNegatives: NegativeItem[];
  vmNegatives: NegativeItem[];
  checks: FollowUpCheck[];
}

export interface OpsImpactVisitResult extends ImpactVisitResultDetail {
  visitedBy: string;
  store: { id: number; name: string; storeNo: string };
  areaName: string | null;
  canReview: boolean;
}

/**
 * What the employee dashboard's fix bar shows: across the visits the staff can see
 * (the latest EMPLOYEE_VISIBLE_VISITS), how many "tidak" findings Ops has since
 * re-checked as fixed ("Sudah diperbaiki") and how many are still open
 * ("Belum diperbaiki" — including findings Ops has not re-checked yet).
 */
export interface ImpactFixOverview {
  visits: number;
  total: number;
  fixed: number;
  open: number;
  /** Share fixed, 0–100 (100 when there is nothing to fix). */
  fixedPct: number;
  /** Most recent Ops re-check across those visits (ISO), if any. */
  lastCheckedAt: string | null;
}

export function impactFixOverview(visits: ImpactVisitResultSummary[]): ImpactFixOverview {
  let total = 0;
  let fixed = 0;
  let lastCheckedAt: string | null = null;
  for (const { followUp } of visits) {
    total += followUp.total;
    fixed += followUp.verified;
    if (followUp.lastCheckedAt && (!lastCheckedAt || followUp.lastCheckedAt > lastCheckedAt)) {
      lastCheckedAt = followUp.lastCheckedAt;
    }
  }
  return {
    visits: visits.length,
    total,
    fixed,
    open: total - fixed,
    fixedPct: total === 0 ? 100 : Math.round((fixed / total) * 100),
    lastCheckedAt,
  };
}

/** The line under the bar's headline — a nudge that follows how far along the store is. */
export function impactFixMessage({ total, fixed, open, fixedPct }: ImpactFixOverview): string {
  if (total === 0) return 'Tidak ada temuan negatif dari kunjungan Ops terakhir. Pertahankan!';
  if (open === 0) return 'Semua temuan sudah diperbaiki. Kerja bagus, tim!';
  if (fixed === 0) return 'Belum ada yang diperbaiki. Mulai dari satu poin — Ops akan mengecek ulang.';
  if (fixedPct >= 50) return `Tinggal ${open} poin lagi — sedikit lagi beres!`;
  return `${fixed} poin sudah beres. Ayo tuntaskan ${open} sisanya sebelum Ops mengecek ulang.`;
}

export const IMPACT_VISIT_TYPE_LABEL: Record<'virtual' | 'on_location', string> = {
  virtual: 'Virtual',
  on_location: 'On Location',
};

export { IMPACT_CHECKLIST_MAX_SCORE, VM_CHECKLIST_MAX_SCORE };
