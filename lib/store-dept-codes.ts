// lib/store-dept-codes.ts
//
// Business Central "Dimension Values" (department dimension) — one entry per
// store, exported from BC as "Dimension Values.xlsx". PRISM keeps the code on
// `stores.dept_code` as a back-office reference (IT + Finance panels only).
//
// A dept code is "SALES-02-<brand>-<nnn>"; the matching PRISM store code
// (`stores.storeNo`, the POS code) is derived from it:
//
//   SALES-02-01-nnn → FSnnn   Fisik Sport
//   SALES-02-02-nnn → FFnnn   Fisik Football
//   SALES-02-03-nnn → ODnnn   ODD
//   SALES-02-06-nnn → SSnnn   Specs Store (BC calls it "MONO - SPECS")
//   SALES-02-01-996 → FO002   Factory Outlet - HOS Cokroaminoto  (exception)
//   SALES-02-01-997 → FO001   Factory Outlet - Daan Mogot        (exception)
//
// `blocked` mirrors BC's Blocked flag — a blocked dimension is a closed store.

export type DeptCodeRow = { code: string; name: string; blocked?: boolean };

export const DEPT_CODE_ROWS: DeptCodeRow[] = [
  { code: 'SALES-02-01-001', name: 'FISIK SPORT - MARGO CITY' },
  { code: 'SALES-02-01-002', name: 'FISIK SPORT - TUNJUNGAN PLAZA 1' },
  { code: 'SALES-02-01-003', name: 'FISIK SPORT - TANGCITY' },
  { code: 'SALES-02-01-005', name: 'FISIK SPORT - AYANI MEGA MALL' },
  { code: 'SALES-02-01-006', name: 'FISIK SPORT - CIREBON SUPER BLOCK' },
  { code: 'SALES-02-01-007', name: 'FISIK SPORT - SETURAN SQUARE' },
  { code: 'SALES-02-01-008', name: 'FISIK SPORT - PADJAJARAN BOGOR' },
  { code: 'SALES-02-01-011', name: 'FISIK SPORT - CIBINONG CITY MALL' },
  { code: 'SALES-02-01-012', name: 'FISIK SPORT - SUMMARECON MAL SERPONG' },
  { code: 'SALES-02-01-013', name: 'FISIK SPORT - PEJATEN VILLAGE' },
  { code: 'SALES-02-01-014', name: 'FISIK SPORT - BANDUNG INDAH PLAZA' },
  { code: 'SALES-02-01-018', name: 'FISIK SPORT - TRANS STUDIO MAKASSAR' },
  { code: 'SALES-02-01-020', name: 'FISIK SPORT - PLAZA MEDAN FAIR' },
  { code: 'SALES-02-01-024', name: 'FISIK SPORT - PALEMBANG ICON MALL PALEMBANG' },
  { code: 'SALES-02-01-025', name: 'FISIK SPORT - BINTARO JAYA XCHANGE MALL' },
  { code: 'SALES-02-01-026', name: 'FISIK SPORT - THE PARK SAWANGAN DEPOK' },
  { code: 'SALES-02-01-027', name: 'FISIK SPORT - DUTA MALL BANJARMASIN' },
  { code: 'SALES-02-01-028', name: 'FISIK SPORT - EWALK MALL BALIKPAPAN' },
  { code: 'SALES-02-01-029', name: 'FISIK SPORT - MALL OLYMPIC GARDEN MALANG' },
  { code: 'SALES-02-01-030', name: 'FISIK SPORT - SUMMARECON MALL BANDUNG' },
  { code: 'SALES-02-01-031', name: 'FISIK SPORT - PAKUWON MALL SOLO' },
  { code: 'SALES-02-01-032', name: 'FISIK SPORT - AEON MALL DELTAMAS CIKARANG' },
  { code: 'SALES-02-01-033', name: 'FISIK SPORT - LIVING WORLD DENPASAR' },
  { code: 'SALES-02-01-034', name: 'FISIK SPORT - LIVING WORLD KOTA WISATA CIBUBUR' },
  { code: 'SALES-02-01-035', name: 'FISIK SPORT - PAKUWON CITY MALL 3 SURABAYA' },
  { code: 'SALES-02-01-036', name: 'FISIK SPORT - PASKAL SHOPPING CENTER' },
  { code: 'SALES-02-01-037', name: '' },
  { code: 'SALES-02-01-038', name: '' },
  { code: 'SALES-02-01-996', name: 'FACTORY OUTLET - FISIK SPORT HOS COKROAMINOTO' },
  { code: 'SALES-02-01-997', name: 'FACTORY OUTLET - DAAN MOGOT' },
  { code: 'SALES-02-02-001', name: 'FISIK FOOTBALL - DAAN MOGOT' },
  { code: 'SALES-02-02-002', name: 'FISIK FOOTBALL - SENAYAN CITY' },
  { code: 'SALES-02-02-003', name: 'FISIK FOOTBALL - GANDARIA CITY' },
  { code: 'SALES-02-02-004', name: 'FISIK FOOTBALL - TUNJUNGAN PLAZA 5' },
  { code: 'SALES-02-02-009', name: 'FISIK FOOTBALL - GRAND INDONESIA' },
  { code: 'SALES-02-02-010', name: 'FISIK FOOTBALL - PONDOK INDAH MALL 3' },
  { code: 'SALES-02-02-011', name: 'FISIK FOOTBALL - RESINDA PARK MALL' },
  { code: 'SALES-02-02-012', name: 'FISIK FOOTBALL - SUMMARECON MALL BEKASI' },
  { code: 'SALES-02-02-013', name: 'FISIK FOOTBALL - BINTARO JAYA EXCHANGE MALL' },
  { code: 'SALES-02-02-014', name: 'FISIK FOOTBALL - PAKUWON MALL BEKASI' },
  { code: 'SALES-02-02-015', name: 'FISIK FOOTBALL - PAKUWON MALL SURABAYA' },
  { code: 'SALES-02-02-016', name: 'FISIK FOOTBALL - SUMMARECON MALL BANDUNG' },
  { code: 'SALES-02-03-002', name: 'ODD - SENAYAN CITY' },
  { code: 'SALES-02-03-004', name: 'ODD - KOTA KASABLANKA' },
  { code: 'SALES-02-03-005', name: 'ODD - PIK AVENUE' },
  { code: 'SALES-02-03-006', name: 'ODD - PAKUWON MALL' },
  { code: 'SALES-02-03-007', name: 'ODD - LIPPO MALL PURI' },
  { code: 'SALES-02-03-008', name: 'ODD - PONDOK INDAH MALL 2' },
  { code: 'SALES-02-03-009', name: 'ODD - SUMMARECON MAL SERPONG' },
  { code: 'SALES-02-03-010', name: 'ODD - TUNJUNGAN PLAZA 4' },
  { code: 'SALES-02-03-011', name: 'ODD - BEACHWALK BALI' },
  { code: 'SALES-02-03-012', name: 'ODD - GRAND INDONESIA' },
  { code: 'SALES-02-03-015', name: 'ODD - MAL KELAPA GADING' },
  { code: 'SALES-02-03-016', name: 'ODD - BINTARO XCHANGE MALL' },
  { code: 'SALES-02-03-017', name: 'ODD - SUMMARECON MALL BEKASI' },
  { code: 'SALES-02-03-018', name: 'ODD - MARGO CITY DEPOK' },
  { code: 'SALES-02-03-019', name: 'ODD - AEON MALL BSD CITY' },
  { code: 'SALES-02-03-020', name: 'ODD - MALL OF INDONESIA' },
  { code: 'SALES-02-03-021', name: 'ODD - TRANS STUDIO MAKASSAR' },
  { code: 'SALES-02-03-022', name: 'ODD - GANDARIA CITY' },
  { code: 'SALES-02-03-023', name: 'ODD - PAKUWON MALL BEKASI', blocked: true },
  { code: 'SALES-02-03-024', name: 'ODD - PENTACITY SHOPPING VENUE' },
  { code: 'SALES-02-03-025', name: 'ODD - LIVING WORLD ALAM SUTERA' },
  { code: 'SALES-02-03-026', name: 'ODD - SUMMARECON MALL BANDUNG' },
  { code: 'SALES-02-03-027', name: 'ODD - AEON MALL DELTAMAS CIKARANG' },
  { code: 'SALES-02-06-001', name: 'MONO - SPECS - TUNJUNGAN PLAZA 3' },
  { code: 'SALES-02-06-002', name: 'MONO - SPECS - RUKO KARTINI CIREBON' },
  { code: 'SALES-02-06-003', name: 'MONO - SPECS - PLAZA MEDAN FAIR' },
];

const BRAND_PREFIX: Record<string, string> = {
  '01': 'FS',
  '02': 'FF',
  '03': 'OD',
  '06': 'SS',
};

const STORE_NO_EXCEPTIONS: Record<string, string> = {
  'SALES-02-01-996': 'FO002',
  'SALES-02-01-997': 'FO001',
};

/** PRISM store code for a BC dept code, or null when the brand segment is unknown. */
export function storeNoFromDeptCode(deptCode: string): string | null {
  const code = deptCode.trim().toUpperCase();
  const exception = STORE_NO_EXCEPTIONS[code];
  if (exception) return exception;

  const m = /^SALES-02-(\d{2})-(\d{3})$/.exec(code);
  if (!m) return null;
  const prefix = BRAND_PREFIX[m[1]];
  return prefix ? `${prefix}${m[2]}` : null;
}

/** Reverse lookup — the dept code registered for a PRISM store code, if any. */
export function deptCodeForStoreNo(storeNo: string): string | null {
  const wanted = storeNo.trim().toUpperCase();
  for (const row of DEPT_CODE_ROWS) {
    if (storeNoFromDeptCode(row.code) === wanted) return row.code;
  }
  return null;
}
