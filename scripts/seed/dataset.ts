// scripts/seed/dataset.ts
// ─────────────────────────────────────────────────────────────────────────────
// The single source of truth for the dev/staging seed world.
//
// Transcribed from:
//   • "Break down target sep 2026 (2).xlsx" — FF001 (Fisik Football - Daan Mogot)
//   • "Break down target sep 2026 (1).xlsx" — FO001 (Factory Outlet - Daan Mogot)
//
// Plus one synthetic DUMMY store for testing (its own area + OPS + roster +
// a simple September schedule).
//
// setup.ts, performance-targets.ts and schedules.ts all consume this.
// ─────────────────────────────────────────────────────────────────────────────

export const YEAR_MONTH = '2026-09';
export const SEED_YEAR = 2026;
export const SEED_MONTH_INDEX = 8; // September, 0-based
export const DAYS_IN_MONTH = 30;

export type EmpTypeCode = 'pic_1' | 'pic_2' | 'sa';
export type TargetRoleCode = 'PIC1' | 'PIC2' | 'SA';

export interface SeedEmployee {
  nik: string;
  name: string;
  empType: EmpTypeCode;
  /** Whole-month % share of the store's monthly target (from the sheet). */
  percentage: number;
}

export interface SeedStore {
  storeNo: string;
  name: string;
  address: string;
  areaName: string;
  latitude: string;
  longitude: string;
  geofenceRadiusM: string;
  pettyCashBalance: string;
  /** Store roster, in target-sheet order (drives SA1, SA2, … ranking). */
  employees: SeedEmployee[];
  /** null → no performance target seeded for this store. */
  target: { monthlySalesTarget: number; monthlyTransactionTarget: number } | null;
  /**
   * Per-employee schedule for YEAR_MONTH. Each `days` string is exactly
   * DAYS_IN_MONTH chars, one of:
   *   E = morning · L = evening · F = full day · X = day off · A = leave (AL)
   * Keyed by NIK. null → no schedule seeded.
   */
  schedule: Record<string, string> | null;
}

export interface SeedBackOfficeUser {
  id: string;
  nik: string;
  name: string;
  roleCode: 'ops' | 'finance' | 'it' | 'audit';
  empTypeCode: 'ops_ho' | 'ops_area' | null;
  areaName: string | null;
}

// ─── Areas ──────────────────────────────────────────────────────────────────

export const AREAS = ['DKI - BALI', 'DUMMY AREA'] as const;

// ─── Back-office accounts ───────────────────────────────────────────────────

export const BACK_OFFICE_USERS: SeedBackOfficeUser[] = [
  { id: 'OPS-HO-001',       nik: 'OPS-HO-001',       name: 'Ops Head Office', roleCode: 'ops',     empTypeCode: 'ops_ho',   areaName: null },
  // Real DKI - BALI area manager (the "INDRIAWAN" on the target sheets).
  { id: 'OPS-DKI-BALI-001', nik: 'A11040401',        name: 'Indriawan',       roleCode: 'ops',     empTypeCode: 'ops_area', areaName: 'DKI - BALI' },
  { id: 'OPS-DUMMY-001',    nik: 'OPS-DUMMY-001',    name: 'Dummy Ops',       roleCode: 'ops',     empTypeCode: 'ops_area', areaName: 'DUMMY AREA' },
  { id: 'FIN-001',          nik: 'FIN-001',          name: 'Finance',         roleCode: 'finance', empTypeCode: null,       areaName: null },
  { id: 'IT-001',           nik: 'IT-001',           name: 'IT',              roleCode: 'it',      empTypeCode: null,       areaName: null },
  { id: 'AUDIT-001',        nik: 'AUDIT-001',        name: 'Audit',           roleCode: 'audit',   empTypeCode: null,       areaName: null },
];

// ─── Daan Mogot location — shared by all three stores ────────────────────────

const DAAN_MOGOT = {
  latitude: '-6.1630687',
  longitude: '106.7739266',
  geofenceRadiusM: '150',
  pettyCashBalance: '1000000',
};

// ─── FF001 · Fisik Football - Daan Mogot ────────────────────────────────────
// "Break down target sep 2026 (2).xlsx"

const FF001: SeedStore = {
  storeNo: 'FF001',
  name: 'Fisik Football - Daan Mogot',
  address: 'DKI · Daan Mogot, DKI Jakarta',
  areaName: 'DKI - BALI',
  ...DAAN_MOGOT,
  employees: [
    { nik: 'A18041273',  name: 'Opik Ramdani',            empType: 'pic_1', percentage: 7.6 },
    { nik: 'A201902047', name: 'Bagas Dwi Cahyo',         empType: 'pic_2', percentage: 7.6 },
    { nik: 'A202301017', name: 'Ratna Kemala',            empType: 'sa',    percentage: 10.6 },
    { nik: 'A202312196', name: 'M. Rifal Agustian',       empType: 'sa',    percentage: 10.6 },
    { nik: 'A202404062', name: 'M. Azhar',                empType: 'sa',    percentage: 10.6 },
    { nik: 'A202508100', name: 'Naila Naziha',            empType: 'sa',    percentage: 10.6 },
    { nik: 'A202511141', name: 'Kheir Tsar Muhammad Ali', empType: 'sa',    percentage: 10.6 },
    { nik: 'A202511149', name: 'Rifqi Fahriza',           empType: 'sa',    percentage: 10.6 },
    { nik: 'A202601008', name: 'Gemilang Dwi Ramadhan',   empType: 'sa',    percentage: 10.6 },
    { nik: 'A202603040', name: 'Amelia',                  empType: 'sa',    percentage: 10.6 },
  ],
  target: { monthlySalesTarget: 1_000_000_000, monthlyTransactionTarget: 1_000 },
  schedule: {
    // MRO SEP 2026 — first block
    A18041273:  'LEXLLLLXLE' + 'LLLEXEEEEE' + 'LXLLLLLEXL',
    A201902047: 'XLEEEEEEEX' + 'EEELLLXLLL' + 'EEEXEEELLE',
    A202301017: 'EXLEEELLXL' + 'ELLEEXLEEE' + 'ELXLELLLEX',
    A202312196: 'XLLLLLLLLE' + 'XEEEEEEXLL' + 'LLLEXEEEEE',
    A202404062: 'LEXLEAAXLL' + 'LLLLLLLXEE' + 'EEEEXLLLLE',
    A202508100: 'EXLEEEXEEE' + 'ELLLXLEEEE' + 'LXLLLLLEXL',
    A202511141: 'LLLLLLEXLL' + 'LEEXLLLLLL' + 'XEEEEEEXLE',
    A202511149: 'EEEXLLLLEX' + 'LEEEEEXLLL' + 'LLEXLEEEEL',
    A202601008: 'LLEXLLEEEE' + 'XEELLXLLLL' + 'EEXEEEELLX',
    A202603040: 'EEEEEEELXL' + 'ELLXEEEEEE' + 'XLLLLLLXEL',
  },
};

// ─── FO001 · Factory Outlet - Daan Mogot ────────────────────────────────────
// "Break down target sep 2026 (1).xlsx" — DATA KARYAWAN + MRO SEP 2026 second block

const FO001: SeedStore = {
  storeNo: 'FO001',
  name: 'Factory Outlet-Daan Mogot',
  address: 'DKI · Daan Mogot, DKI Jakarta',
  areaName: 'DKI - BALI',
  ...DAAN_MOGOT,
  employees: [
    { nik: 'A201908250', name: 'Agung Rianto',        empType: 'pic_1', percentage: 10 },
    { nik: 'A202408164', name: 'Roy Waldamer P',      empType: 'pic_2', percentage: 45 },
    { nik: 'A201906208', name: 'Dennis Jala Pranada', empType: 'sa',    percentage: 45 },
  ],
  target: { monthlySalesTarget: 271_000_000, monthlyTransactionTarget: 271 },
  schedule: {
    // MRO SEP 2026 — second block (AGUNG / ROY / DENIS)
    A201908250: 'EEXLLLLXLL' + 'LLLLXEEEEE' + 'LXLLLLLLXE',
    A202408164: 'XLLLLLLLXL' + 'EEEEEXAALL' + 'LLXLLLLEEX',
    A201906208: 'LXLEEEEEEX' + 'LLLLLLXLLL' + 'EEEXEEELLL',
  },
};

// ─── DUMMY · synthetic test store ───────────────────────────────────────────
// Same Daan Mogot geofence as the real stores. Its own area + OPS user.
// Schedule is a simple deterministic pattern so "today" is always testable.

const DUMMY: SeedStore = {
  storeNo: 'DUMMY-001',
  name: 'Dummy Store',
  address: 'DKI · Daan Mogot, DKI Jakarta (test)',
  areaName: 'DUMMY AREA',
  ...DAAN_MOGOT,
  employees: [
    { nik: 'DUMMY-PIC1', name: 'Dummy PIC 1', empType: 'pic_1', percentage: 20 },
    { nik: 'DUMMY-PIC2', name: 'Dummy PIC 2', empType: 'pic_2', percentage: 30 },
    { nik: 'DUMMY-SA',   name: 'Dummy SA',    empType: 'sa',    percentage: 50 },
  ],
  target: { monthlySalesTarget: 100_000_000, monthlyTransactionTarget: 400 },
  schedule: {
    // PIC1 full day, PIC2 morning, SA evening — one off day each per week.
    'DUMMY-PIC1': 'FFFFFFX' + 'FFFFFFX' + 'FFFFFFX' + 'FFFFFFX' + 'FF',
    'DUMMY-PIC2': 'EEEEEX'  + 'EEEEEEX' + 'EEEEEEX' + 'EEEEEEX' + 'EEE',
    'DUMMY-SA':   'LLX'     + 'LLLLLLX' + 'LLLLLLX' + 'LLLLLLX' + 'LLLLLL',
  },
};

// ─── All stores ─────────────────────────────────────────────────────────────

export const STORES: SeedStore[] = [FF001, FO001, DUMMY];

/** targetRoleCode + monthly-roster sortOrder for a store's employee list. */
export function rosterSlots(
  employees: SeedEmployee[],
): Array<{ nik: string; roleCode: TargetRoleCode; sortOrder: number; percentage: number }> {
  let saN = 0;
  return employees.map((e) => {
    if (e.empType === 'pic_1') return { nik: e.nik, roleCode: 'PIC1', sortOrder: 0, percentage: e.percentage };
    if (e.empType === 'pic_2') return { nik: e.nik, roleCode: 'PIC2', sortOrder: 0, percentage: e.percentage };
    saN += 1;
    return { nik: e.nik, roleCode: 'SA', sortOrder: saN, percentage: e.percentage };
  });
}
