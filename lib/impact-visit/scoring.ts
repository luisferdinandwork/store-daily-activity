// lib/impact-visit/scoring.ts
//
// Binary per-item scoring, matching the paper form's own rule: "Apabila
// terdapat salah satu point yang di periksa tidak dilakukan, maka nilainya
// 0" — an item is all-or-nothing. 'ya' scores its full point value,
// anything else (including unanswered) scores 0. No partial credit.

import type { ChecklistItem } from './checklist-config';

export type ChecklistAnswer = 'ya' | 'tidak';

export interface ChecklistItemResponse {
  answer?: ChecklistAnswer;
  note?: string;
}

export type ChecklistResponses = Record<string, ChecklistItemResponse>;

export interface ChecklistScoreResult {
  score: number;
  maxScore: number;
  grade: 'A' | 'B';
  answeredCount: number;
  totalCount: number;
}

export function scoreChecklist(
  items: ChecklistItem[],
  responses: ChecklistResponses,
  passThreshold: number,
): ChecklistScoreResult {
  const maxScore = items.reduce((sum, item) => sum + item.points, 0);

  let score = 0;
  let answeredCount = 0;

  for (const item of items) {
    const response = responses[item.id];
    if (!response?.answer) continue;
    answeredCount++;
    if (response.answer === 'ya') score += item.points;
  }

  return {
    score,
    maxScore,
    grade: score >= passThreshold ? 'A' : 'B',
    answeredCount,
    totalCount: items.length,
  };
}

export const IMPACT_CHECKLIST_PASS_THRESHOLD = 90;
export const VM_CHECKLIST_PASS_THRESHOLD = 51;
