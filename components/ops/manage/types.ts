// components/ops/manage/types.ts

export interface ManageEmployee {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  employeeTypeId: number | null;
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
  isTemporary: boolean;
  effectiveTo: string | null;
  previousStoreName: string | null;
}

export interface ManageStore {
  id: number;
  name: string;
  address: string;
  areaId: number;
  areaName: string;
  employeeCount: number;
}

export interface ManageArea {
  id: number;
  name: string;
  storeCount: number;
  employeeCount: number;
}

export interface ManageLookups {
  employeeTypes: Array<{ id: number; code: string; label: string }>;
  employeeRoleId: number;
}

export interface WorkspaceData {
  employees: ManageEmployee[];
  stores: ManageStore[];
  areas: ManageArea[];
  lookups: ManageLookups;
  actor: { isHO: boolean; areaId: number | null };
}

export interface HistoryItem {
  id: number;
  storeName: string | null;
  areaName: string | null;
  roleLabel: string | null;
  employeeTypeLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  isTemporary: boolean;
  revertedAt: string | null;
  previousStoreName: string | null;
  assignedByName: string | null;
  notes: string | null;
}

export interface ScheduleDay {
  date: string;
  shiftCode: string | null;
  isOff: boolean;
  isLeave: boolean;
}

export interface TransferPreview {
  affectedScheduleCount: number;
  affectedMonthlyEntryCount: number;
  attendanceToWipeCount: number;
  affectedDates: string[];
  fromStore: { id: number; name: string; areaName: string | null } | null;
  toStore: { id: number; name: string; areaName: string | null };
  user: { id: string; name: string; nik: string };
  mode: 'permanent' | 'temporary';
  effectiveFrom: string;
  effectiveTo: string | null;
  crossArea: boolean;
}