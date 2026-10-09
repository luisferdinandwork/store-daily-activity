// lib/impact-visit/completeness.ts
//
// What an Impact Visit still has unfilled — the warning Ops gets before
// submitting ("Masih ada 12 isian yang belum diisi"). Submitting anyway is
// allowed: an unanswered checklist item simply scores 0. Proof (screenshot /
// geo-tag + photo) is not listed here — it blocks submit on its own.
// Pure + client-safe; copy is Indonesian.

import {
  IMPACT_CHECKLIST,
  VM_CHECKLIST,
  cashRowTotal,
  type CashMoneyData,
  type ChecklistItem,
} from './checklist-config';
import type { ChecklistResponses } from './scoring';

export type VisitTab = 'checklist' | 'cash' | 'vm';

export interface MissingField {
  key: string;
  /** The tab that holds it; null = the header fields above the tabs. */
  tab: VisitTab | null;
  /** "Checklist: 5 dari 44 poin belum dijawab". */
  label: string;
  /** How many isian this line stands for. */
  count: number;
  /** First unanswered checklist item — where "Lihat" scrolls to. */
  firstItemId?: string;
}

export interface VisitCompletenessInput {
  targetBulanBerjalan: string | null;
  estimasiAchievement: string | null;
  checklistResponses: ChecklistResponses;
  vmChecklistResponses: ChecklistResponses;
  cashMoneyData: CashMoneyData;
}

function unanswered(items: ChecklistItem[], responses: ChecklistResponses): ChecklistItem[] {
  return items.filter((item) => !responses[item.id]?.answer);
}

const CASH_GRIDS: { key: keyof Omit<CashMoneyData, 'cashOut'>; label: string }[] = [
  { key: 'uangModal', label: 'Uang Modal' },
  { key: 'uangSisaSetoran', label: 'Uang Sisa Setoran' },
  { key: 'uangPettyCash', label: 'Uang Petty Cash' },
  { key: 'uangSalesCash', label: 'Uang Sales Cash' },
];

export function missingVisitFields(v: VisitCompletenessInput): MissingField[] {
  const out: MissingField[] = [];

  if (!v.targetBulanBerjalan?.trim()) {
    out.push({ key: 'target', tab: null, label: 'Target bulan berjalan belum diisi', count: 1 });
  }
  if (!v.estimasiAchievement?.trim()) {
    out.push({ key: 'estimasi', tab: null, label: 'Estimasi Achievement belum diisi', count: 1 });
  }

  const main = unanswered(IMPACT_CHECKLIST, v.checklistResponses);
  if (main.length) {
    out.push({
      key: 'checklist',
      tab: 'checklist',
      label: `Checklist: ${main.length} dari ${IMPACT_CHECKLIST.length} poin belum dijawab`,
      count: main.length,
      firstItemId: main[0].id,
    });
  }

  // A count of Rp 0 can't be told apart from "not counted yet", so it reads as such.
  for (const grid of CASH_GRIDS) {
    if (cashRowTotal(v.cashMoneyData[grid.key] ?? []) === 0) {
      out.push({ key: grid.key, tab: 'cash', label: `${grid.label} belum dihitung (Rp 0)`, count: 1 });
    }
  }
  if (v.cashMoneyData.cashOut == null) {
    out.push({ key: 'cashOut', tab: 'cash', label: 'Cash Out belum diisi', count: 1 });
  }

  const vm = unanswered(VM_CHECKLIST, v.vmChecklistResponses);
  if (vm.length) {
    out.push({
      key: 'vm',
      tab: 'vm',
      label: `VM Checklist: ${vm.length} dari ${VM_CHECKLIST.length} poin belum dijawab`,
      count: vm.length,
      firstItemId: vm[0].id,
    });
  }

  return out;
}

export function totalMissing(fields: MissingField[]): number {
  return fields.reduce((sum, f) => sum + f.count, 0);
}
