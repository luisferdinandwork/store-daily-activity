import type { ChecklistResponses } from "./scoring";
export interface ReportCell {
  visitId: string;
  visitDate: string;
  visitorName: string | null;
  checklist: { pass: boolean; score: number; max: number };
  money: { ok: boolean };
  vm: { pass: boolean; score: number; max: number };
  checklistResponses: ChecklistResponses;
  vmChecklistResponses: ChecklistResponses;
}
export interface StoreReportRow {
  storeId: string;
  storeName: string;
  storeNo: string;
  areaName: string | null;
  months: Record<
    string,
    { virtual: ReportCell | null; onLocation: ReportCell | null }
  >;
}
