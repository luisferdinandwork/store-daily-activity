// lib/user-import.ts
//
// Bulk Users Excel import — parse, validate, (optionally) commit.
//
// Mirrors lib/schedule-import.ts's "collect errors, don't abort" philosophy,
// but this is a flat table (one row per user) so parsing is header-name
// based rather than position/anchor based.
//
// Two layouts are understood by the same parser (columns are matched by
// header name, so either works, and so does a mix):
//   • the PRISM template  — NIK, Name, Role Code, Employee Type Code,
//     Store No, Area Name, …  (app/api/it/users/template/route.ts)
//   • an HR roster export — Employee No., Employee Name, Store Code,
//     Organization Unit, ZONA, LEVEL, STATUS, …  LEVEL (PIC 1 / PIC 2 / SA n /
//     Area Manager / OPS HO) stands in for Role Code + Employee Type Code.
//
// Areas and stores the file refers to that don't exist yet are created along
// with the users: an unknown Area Name (ZONA) becomes a new area; an unknown
// Store No becomes a new store when the row also carries a Store Name
// (Organization Unit) and an Area Name. New stores without coordinates land on
// DEFAULT_STORE_LOCATION. Existing areas/stores are never modified.
//
// Flow: parseUsersWorkbook() turns a workbook into flat rows (or a hard
// headerError if no sheet has the required columns), then
// buildUserImportReport() validates every row — NIK/Role/Employee Type/
// Store/Area references, the ops_area 1:1 area-ownership rule, password
// policy, duplicate NIKs within the file — and, when `commit` is true,
// writes only the rows that passed validation (each in its own try/catch,
// via setUserHomeStore() so userStoreAssignments stays in sync).
//
// Called twice from app/api/it/users/import/route.ts: once with
// commit:false (preview/"great verification" step the admin reviews before
// anything is written), once with commit:true (the confirmed import).

import * as XLSX from 'xlsx';
import { validateNewPassword } from '@/lib/auth/password';
import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores, areas } from '@/lib/db/schema';
import { setUserHomeStore } from '@/lib/db/utils/user-store-assignment';

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'password123'; // matches this repo's seed convention, see CLAUDE.md

/**
 * Where a brand-new store is placed when the file gives no coordinates: the
 * same "current location" every store in the dev seed uses
 * (scripts/seed/dataset.ts → DAAN_MOGOT). IT replaces it with the real
 * location from Store Management. (A store with NO coordinates skips the
 * geofence check entirely — see assertInGeofence in lib/db/utils/tasks.ts —
 * which is why a placeholder is used rather than leaving it empty.)
 */
export const DEFAULT_STORE_LOCATION = {
  latitude: '-6.1630687',
  longitude: '106.7739266',
  geofenceRadiusM: '150',
} as const;

const DEFAULT_STORE_ADDRESS = 'Alamat belum diisi';

// Employee type code → the role code it's only valid under.
export const EMP_TYPE_ROLE_CODE: Record<string, string> = {
  pic_1: 'employee',
  pic_2: 'employee',
  sa: 'employee',
  ops_ho: 'ops',
  ops_area: 'ops',
};

// ─── Column definitions (shared with the template generator) ────────────────

export type UserImportColumnKey =
  | 'nik' | 'name' | 'roleCode' | 'employeeTypeCode' | 'level'
  | 'storeNo' | 'storeName' | 'areaName' | 'address'
  | 'latitude' | 'longitude' | 'geofenceRadiusM'
  | 'password' | 'active';

export interface UserImportColumnDef {
  key: UserImportColumnKey;
  label: string;
  required: boolean;
  aliases: string[];
  /** Listed in the downloadable template (roster-only aliases like LEVEL are not). */
  inTemplate: boolean;
}

/** Template column order. `aliases` are compared lower-cased, whitespace-collapsed. */
export const USER_IMPORT_COLUMNS: UserImportColumnDef[] = [
  { key: 'nik', label: 'NIK', required: true, inTemplate: true, aliases: ['nik', 'employee no.', 'employee no', 'employee number', 'no karyawan'] },
  { key: 'name', label: 'Name', required: true, inTemplate: true, aliases: ['name', 'nama', 'employee name', 'nama karyawan'] },
  { key: 'roleCode', label: 'Role Code', required: false, inTemplate: true, aliases: ['role code', 'rolecode', 'role'] },
  { key: 'employeeTypeCode', label: 'Employee Type Code', required: false, inTemplate: true, aliases: ['employee type code', 'employeetypecode', 'employee type'] },
  { key: 'storeNo', label: 'Store No', required: false, inTemplate: true, aliases: ['store no', 'storeno', 'store number', 'store code'] },
  { key: 'storeName', label: 'Store Name', required: false, inTemplate: true, aliases: ['store name', 'storename', 'nama toko', 'organization unit', 'organisation unit'] },
  { key: 'areaName', label: 'Area Name', required: false, inTemplate: true, aliases: ['area name', 'areaname', 'area', 'zona', 'zone'] },
  { key: 'address', label: 'Address', required: false, inTemplate: true, aliases: ['address', 'store address', 'alamat'] },
  { key: 'latitude', label: 'Latitude', required: false, inTemplate: true, aliases: ['latitude', 'lat'] },
  { key: 'longitude', label: 'Longitude', required: false, inTemplate: true, aliases: ['longitude', 'lng', 'long'] },
  { key: 'geofenceRadiusM', label: 'Geofence Radius (m)', required: false, inTemplate: true, aliases: ['geofence radius (m)', 'geofence radius', 'geofence', 'radius'] },
  { key: 'password', label: 'Password', required: false, inTemplate: true, aliases: ['password'] },
  { key: 'active', label: 'Active', required: false, inTemplate: true, aliases: ['active', 'is active', 'status'] },
  { key: 'level', label: 'Level', required: false, inTemplate: false, aliases: ['level'] },
];

// ─── Parsing ──────────────────────────────────────────────────────────────────

export interface RawUserImportRow {
  excelRow: number;
  nik: string;
  name: string;
  roleCode: string;
  employeeTypeCode: string;
  level: string;
  storeNo: string;
  storeName: string;
  areaName: string;
  address: string;
  latitude: string;
  longitude: string;
  geofenceRadiusM: string;
  password: string;
  active: string;
}

export interface ImportSheetInfo {
  name: string;
  /** Data rows below the header row. */
  rowCount: number;
}

export type ParseUsersResult =
  | { rows: RawUserImportRow[]; sheetName: string; sheets: ImportSheetInfo[] }
  | { headerError: string };

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Some exports (this project's HR roster among them) declare a used range that
 * runs to the last row of the sheet (A1:K1048576). Shrink it to the last cell
 * that actually holds something, otherwise sheet_to_json materialises a million
 * empty rows.
 */
function trimSheetRange(ws: XLSX.WorkSheet): void {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  let lastRow = range.s.r;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const { r } = XLSX.utils.decode_cell(key);
    if (r > lastRow) lastRow = r;
  }
  if (lastRow < range.e.r) {
    range.e.r = lastRow;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
}

/** Rows of one sheet, or null when it has no header row with the required columns. */
function parseUserSheet(ws: XLSX.WorkSheet): RawUserImportRow[] | null {
  trimSheetRange(ws);
  const firstRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: false, defval: '' });

  let headerRowIdx = -1;
  let colIndex: Partial<Record<UserImportColumnKey, number>> = {};

  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const found: Partial<Record<UserImportColumnKey, number>> = {};
    for (const col of USER_IMPORT_COLUMNS) {
      const idx = cells.findIndex((c) => col.aliases.includes(c));
      if (idx !== -1) found[col.key] = idx;
    }
    const hasAllRequired = USER_IMPORT_COLUMNS.filter((c) => c.required).every((c) => found[c.key] !== undefined);
    if (hasAllRequired) {
      headerRowIdx = r;
      colIndex = found;
      break;
    }
  }

  if (headerRowIdx === -1) return null;

  const rows: RawUserImportRow[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (key: UserImportColumnKey) => {
      const idx = colIndex[key];
      return idx === undefined ? '' : String(cells[idx] ?? '').trim();
    };

    const row: RawUserImportRow = {
      excelRow: firstRow + r + 1,
      nik: get('nik'),
      name: get('name'),
      roleCode: get('roleCode'),
      employeeTypeCode: get('employeeTypeCode'),
      level: get('level'),
      storeNo: get('storeNo'),
      storeName: get('storeName'),
      areaName: get('areaName'),
      address: get('address'),
      latitude: get('latitude'),
      longitude: get('longitude'),
      geofenceRadiusM: get('geofenceRadiusM'),
      password: get('password'),
      active: get('active'),
    };

    const isBlank = (Object.keys(row) as (keyof RawUserImportRow)[]).every((k) => k === 'excelRow' || row[k] === '');
    if (isBlank) continue;

    rows.push(row);
  }

  return rows;
}

/**
 * `requestedSheet` picks a specific sheet; otherwise the "Users" sheet if there
 * is one, else the first sheet that has the required columns. `sheets` lists
 * every importable sheet so the UI can offer a picker (an HR workbook often
 * holds several roster views of the same people).
 */
export function parseUsersWorkbook(buffer: ArrayBuffer, requestedSheet?: string): ParseUsersResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  if (wb.SheetNames.length === 0) return { headerError: 'The uploaded file has no sheets.' };

  const parsed = new Map<string, RawUserImportRow[]>();
  for (const name of wb.SheetNames) {
    const rows = parseUserSheet(wb.Sheets[name]);
    if (rows) parsed.set(name, rows);
  }

  if (parsed.size === 0) {
    const requiredLabels = USER_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.label).join(', ');
    return {
      headerError:
        `Could not find a header row with the required columns (${requiredLabels}) in any sheet. ` +
        `Use the downloaded template, or an HR roster with "Employee No." and "Employee Name" columns, without renaming the headers.`,
    };
  }

  if (requestedSheet && !parsed.has(requestedSheet)) {
    return { headerError: `Sheet "${requestedSheet}" has no header row with the required columns.` };
  }

  const sheets: ImportSheetInfo[] = [...parsed].map(([name, rows]) => ({ name, rowCount: rows.length }));
  const sheetName =
    requestedSheet
    ?? wb.SheetNames.find((n) => parsed.has(n) && n.trim().toLowerCase() === 'users')
    ?? sheets[0].name;

  return { rows: parsed.get(sheetName)!, sheetName, sheets };
}

// ─── Value helpers ────────────────────────────────────────────────────────────

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
const areaKeyOf = (name: string) => tidy(name).toLowerCase();

/** LEVEL cell ("PIC 1", "SA5", "Area Manager", …) → employee type code, or null if unrecognised. */
function levelToEmployeeTypeCode(level: string): string | null {
  const v = level.toLowerCase().replace(/[\s._-]+/g, '');
  if (v === 'pic1') return 'pic_1';
  if (v === 'pic2') return 'pic_2';
  if (/^sa\d*$/.test(v)) return 'sa';
  if (v === 'areamanager' || v === 'opsarea') return 'ops_area';
  if (v === 'opsho') return 'ops_ho';
  return null;
}

const ACTIVE_TRUE = new Set(['true', '1', 'yes', 'y', 'active', 'aktif']);
const ACTIVE_FALSE = new Set(['false', '0', 'no', 'n', 'inactive', 'nonaktif']);

/**
 * TRUE/FALSE-style flags, plus the free-text HR STATUS column
 * ("AKTIF (MUTASI PER 04 SEPTEMBER 2026)", "Resign Per Tanggal 12 September
 * 2026 (closing store)"). null = not recognised.
 */
function parseActiveFlag(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (ACTIVE_TRUE.has(v) || /^(aktif|active)\b/.test(v)) return true;
  if (ACTIVE_FALSE.has(v) || /^(resign|non ?aktif|inactive|keluar)\b/.test(v)) return false;
  return null;
}

// Leading brand of an HR "Organization Unit", split from the location so the
// name reads like the seeded stores ("Fisik Football - Daan Mogot").
const STORE_BRANDS = ['FISIK FOOTBALL', 'FISIK SPORT', 'FACTORY OUTLET', 'SPECS STORE', 'ODD'];
const KEEP_UPPERCASE = new Set(['ODD', 'PIK', 'HOS']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\S+/g, (w) => (KEEP_UPPERCASE.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
}

/** "AFF002 - FISIK FOOTBALL SENAYAN CITY" → "Fisik Football - Senayan City". */
export function deriveStoreName(source: string, storeNo: string): string {
  let s = tidy(source).replace(/^A?[A-Za-z]{2,4}\d{2,4}\s*-\s*/, '');
  if (!s) return storeNo;
  const upper = s.toUpperCase();
  const brand = STORE_BRANDS.find((b) => upper.startsWith(`${b} `));
  if (brand) s = `${titleCase(brand)} - ${titleCase(s.slice(brand.length))}`.replace(/\s+/g, ' ');
  else s = titleCase(s);
  return s.trim();
}

function parseNumberInRange(raw: string, min: number, max: number): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export interface UserImportLookups {
  roles: { id: number; code: string; label: string; isActive: boolean }[];
  employeeTypes: { id: number; code: string; label: string; isActive: boolean }[];
  stores: { id: number; storeNo: string; name: string; areaId: number }[];
  areas: { id: number; name: string }[];
  existingUsers: {
    id: string;
    nik: string;
    name: string;
    roleId: number;
    employeeTypeId: number | null;
    homeStoreId: number | null;
    areaId: number | null;
    isActive: boolean;
  }[];
}

export async function loadUserImportLookups(): Promise<UserImportLookups> {
  const [roleRows, empTypeRows, storeRows, areaRows, userRows] = await Promise.all([
    db.select({ id: userRoles.id, code: userRoles.code, label: userRoles.label, isActive: userRoles.isActive })
      .from(userRoles).orderBy(asc(userRoles.sortOrder), asc(userRoles.id)),
    db.select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label, isActive: employeeTypes.isActive })
      .from(employeeTypes).orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.id)),
    db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, areaId: stores.areaId })
      .from(stores).orderBy(asc(stores.name)),
    db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(asc(areas.name)),
    db.select({
      id: users.id, nik: users.nik, name: users.name, roleId: users.roleId,
      employeeTypeId: users.employeeTypeId, homeStoreId: users.homeStoreId, areaId: users.areaId, isActive: users.isActive,
    }).from(users),
  ]);

  return { roles: roleRows, employeeTypes: empTypeRows, stores: storeRows, areas: areaRows, existingUsers: userRows };
}

// ─── Validation + commit ──────────────────────────────────────────────────────

export interface UserImportRowResult {
  row: number;
  nik: string;
  name: string;
  /** `unchanged` = the NIK exists and every value in the file already matches. */
  action: 'create' | 'update' | 'unchanged';
  status: 'ok' | 'error';
  errors: string[];
  warnings: string[];
  /** Neutral information, e.g. "New store: …" — not a problem. */
  notes: string[];
  /** Only meaningful when the report was built with commit:true. */
  committed?: boolean;
}

export interface UserImportReport {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  invalid: number;
  created: number;
  updated: number;
  failed: number;
  /** Areas / stores the valid rows need that don't exist yet. */
  newAreas: string[];
  newStores: { storeNo: string; name: string; areaName: string; defaultLocation: boolean }[];
  /** Only meaningful when the report was built with commit:true. */
  areasCreated: number;
  storesCreated: number;
  rows: UserImportRowResult[];
}

interface PlannedArea {
  name: string;
  /** null until the area exists (i.e. while it is still only planned). */
  id: number | null;
  isNew: boolean;
}

interface PlannedStore {
  storeNo: string;
  name: string;
  area: PlannedArea;
  id: number | null;
  isNew: boolean;
  /** Only for stores this import will create. */
  details: { address: string; latitude: string; longitude: string; geofenceRadiusM: string; defaultLocation: boolean } | null;
}

export async function buildUserImportReport(
  raw: RawUserImportRow[],
  lookups: UserImportLookups,
  opts: { commit: boolean; assignedBy: string },
): Promise<UserImportReport> {
  const roleByCode = new Map(lookups.roles.map((r) => [r.code.toLowerCase(), r]));
  const roleById = new Map(lookups.roles.map((r) => [r.id, r]));
  const empTypeByCode = new Map(lookups.employeeTypes.map((t) => [t.code.toLowerCase(), t]));
  const existingByNik = new Map(lookups.existingUsers.map((u) => [u.nik, u]));

  // Areas and stores as "planned" entries: the ones that already exist (with
  // ids) plus any the file introduces (id null until commit creates them).
  const areaByKey = new Map<string, PlannedArea>();
  const areaById = new Map<number, PlannedArea>();
  for (const a of lookups.areas) {
    const planned: PlannedArea = { name: a.name, id: a.id, isNew: false };
    areaByKey.set(areaKeyOf(a.name), planned);
    areaById.set(a.id, planned);
  }
  const storeByKey = new Map<string, PlannedStore>();
  const storeById = new Map<number, PlannedStore>();
  for (const s of lookups.stores) {
    const area = areaById.get(s.areaId);
    if (!area) continue;
    const planned: PlannedStore = { storeNo: s.storeNo, name: s.name, area, id: s.id, isNew: false, details: null };
    storeByKey.set(s.storeNo.toLowerCase(), planned);
    storeById.set(s.id, planned);
  }

  // area -> nik of the current ops_area holder (seeded from DB, updated as
  // rows in this file claim areas — mirrors the 1:1 rule enforced by
  // /api/ops/areas/[id]/assign, surfaced here as validation instead of
  // silent displacement).
  const opsAreaTypeId = empTypeByCode.get('ops_area')?.id;
  const opsAreaClaims = new Map<PlannedArea, string>();
  if (opsAreaTypeId != null) {
    for (const u of lookups.existingUsers) {
      const area = u.areaId != null ? areaById.get(u.areaId) : undefined;
      if (u.employeeTypeId === opsAreaTypeId && area && u.isActive) opsAreaClaims.set(area, u.nik);
    }
  }

  // New areas/stores only get written for rows that pass validation, so
  // creation is lazy (first valid row that needs one) and these track which
  // planned entries a valid row actually depends on.
  const neededAreas = new Set<PlannedArea>();
  const neededStores = new Set<PlannedStore>();
  let areasCreated = 0;
  let storesCreated = 0;

  async function ensureArea(area: PlannedArea): Promise<number> {
    if (area.id != null) return area.id;
    const [row] = await db.insert(areas).values({ name: area.name }).returning({ id: areas.id });
    area.id = row.id;
    areasCreated += 1;
    return row.id;
  }

  async function ensureStore(store: PlannedStore): Promise<number> {
    if (store.id != null) return store.id;
    const d = store.details!;
    const areaId = await ensureArea(store.area);
    const [row] = await db
      .insert(stores)
      .values({
        storeNo: store.storeNo, name: store.name, address: d.address, areaId,
        latitude: d.latitude, longitude: d.longitude, geofenceRadiusM: d.geofenceRadiusM,
      })
      .onConflictDoNothing({ target: stores.storeNo })
      .returning({ id: stores.id });
    if (row) {
      store.id = row.id;
      storesCreated += 1;
    } else {
      // Created by someone else between preview and commit — reuse it.
      const [existingRow] = await db.select({ id: stores.id }).from(stores).where(eq(stores.storeNo, store.storeNo)).limit(1);
      store.id = existingRow.id;
    }
    return store.id;
  }

  const seenNiks = new Map<string, number>(); // lowercased nik -> first excelRow seen
  const results: UserImportRowResult[] = [];

  for (const raw_ of raw) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];

    const nik = raw_.nik.trim();
    const name = tidy(raw_.name);

    if (!nik) errors.push('NIK is required.');
    if (!name) errors.push('Name is required.');

    if (nik) {
      const dupRow = seenNiks.get(nik.toLowerCase());
      if (dupRow != null) {
        errors.push(`Duplicate NIK "${nik}" — already used by row ${dupRow} in this file.`);
      } else {
        seenNiks.set(nik.toLowerCase(), raw_.excelRow);
      }
    }

    if (!nik) {
      results.push({ row: raw_.excelRow, nik, name, action: 'create', status: 'error', errors, warnings, notes });
      continue;
    }

    const existing = existingByNik.get(nik);
    let action: UserImportRowResult['action'] = existing ? 'update' : 'create';

    // ── LEVEL (HR roster) → employee type + role, unless given explicitly ──
    const levelRaw = raw_.level.trim();
    let levelEmpTypeCode: string | null = null;
    if (levelRaw) {
      levelEmpTypeCode = levelToEmployeeTypeCode(levelRaw);
      if (!levelEmpTypeCode) {
        errors.push(`Level "${levelRaw}" is not recognised — use PIC 1, PIC 2, SA, Area Manager or OPS HO.`);
      }
    }

    // ── Role ──
    const roleCodeRaw = raw_.roleCode.trim() || (levelEmpTypeCode ? EMP_TYPE_ROLE_CODE[levelEmpTypeCode] : '');
    let roleId: number | undefined;
    let roleCode: string | undefined;
    if (roleCodeRaw) {
      const role = roleByCode.get(roleCodeRaw.toLowerCase());
      if (!role || !role.isActive) {
        errors.push(`Role Code "${roleCodeRaw}" is not a valid active role.`);
      } else {
        roleId = role.id;
        roleCode = role.code;
      }
    } else if (action === 'update' && existing) {
      roleId = existing.roleId;
      roleCode = roleById.get(existing.roleId)?.code;
    } else if (!levelRaw) {
      errors.push('Role Code (or Level) is required for new users.');
    }

    // ── Employee type ──
    const empTypeCodeRaw = raw_.employeeTypeCode.trim() || levelEmpTypeCode || '';
    let employeeTypeId: number | null | undefined;
    let employeeTypeCode: string | null | undefined;
    if (empTypeCodeRaw) {
      if (empTypeCodeRaw.toUpperCase() === 'NONE') {
        employeeTypeId = null;
        employeeTypeCode = null;
      } else {
        const empType = empTypeByCode.get(empTypeCodeRaw.toLowerCase());
        if (!empType || !empType.isActive) {
          errors.push(`Employee Type Code "${empTypeCodeRaw}" is not a valid active employee type.`);
        } else {
          employeeTypeId = empType.id;
          employeeTypeCode = empType.code;
          const requiredRole = EMP_TYPE_ROLE_CODE[empType.code];
          if (requiredRole && roleCode && roleCode !== requiredRole) {
            errors.push(`Employee Type "${empType.code}" requires Role Code "${requiredRole}", not "${roleCode}".`);
          }
        }
      }
    } else if (action === 'update' && existing) {
      employeeTypeId = existing.employeeTypeId;
      employeeTypeCode = employeeTypeId != null ? (lookups.employeeTypes.find((t) => t.id === employeeTypeId)?.code ?? null) : null;
    } else {
      employeeTypeId = null;
      employeeTypeCode = null;
    }

    // ── Area (explicit) — an unknown name becomes a new area ──
    const areaNameRaw = tidy(raw_.areaName);
    const areaExplicit = areaNameRaw !== '';
    let explicitArea: PlannedArea | null = null; // null = NONE (only read when areaExplicit)
    if (areaExplicit && areaNameRaw.toUpperCase() !== 'NONE') {
      let planned = areaByKey.get(areaKeyOf(areaNameRaw));
      if (!planned) {
        planned = { name: areaNameRaw, id: null, isNew: true };
        areaByKey.set(areaKeyOf(areaNameRaw), planned);
      }
      explicitArea = planned;
    }

    // ── Store — an unknown code becomes a new store when we know its name + area ──
    const storeNoRaw = tidy(raw_.storeNo);
    const storeExplicit = storeNoRaw !== '';
    const existingHomeStore = existing?.homeStoreId != null ? (storeById.get(existing.homeStoreId) ?? null) : null;
    let homeStore: PlannedStore | null = action === 'update' ? existingHomeStore : null;
    if (storeExplicit && storeNoRaw.toUpperCase() === 'NONE') {
      homeStore = null;
    } else if (storeExplicit) {
      let planned = storeByKey.get(storeNoRaw.toLowerCase());
      if (!planned) {
        const nameSource = raw_.storeName.trim();
        if (!nameSource) {
          errors.push(`Store No "${storeNoRaw}" was not found. To create it, fill Store Name (Organization Unit) and Area Name (ZONA).`);
        } else if (!explicitArea) {
          errors.push(`Store No "${storeNoRaw}" is new — Area Name (ZONA) is required to create it.`);
        } else {
          const storeErrors: string[] = [];
          const latRaw = raw_.latitude.trim();
          const lngRaw = raw_.longitude.trim();
          const radiusRaw = raw_.geofenceRadiusM.trim();

          let { latitude, longitude } = DEFAULT_STORE_LOCATION as { latitude: string; longitude: string };
          let defaultLocation = true;
          if (latRaw || lngRaw) {
            const lat = latRaw ? parseNumberInRange(latRaw, -90, 90) : null;
            const lng = lngRaw ? parseNumberInRange(lngRaw, -180, 180) : null;
            if (!latRaw || !lngRaw) storeErrors.push('Latitude and Longitude must be filled together.');
            else if (lat == null) storeErrors.push(`Latitude "${latRaw}" must be a number between -90 and 90.`);
            else if (lng == null) storeErrors.push(`Longitude "${lngRaw}" must be a number between -180 and 180.`);
            else {
              latitude = lat.toFixed(7);
              longitude = lng.toFixed(7);
              defaultLocation = false;
            }
          }

          let geofenceRadiusM: string = DEFAULT_STORE_LOCATION.geofenceRadiusM;
          if (radiusRaw) {
            const radius = parseNumberInRange(radiusRaw, 1, 100_000);
            if (radius == null) storeErrors.push(`Geofence Radius "${radiusRaw}" must be a number of metres (1–100000).`);
            else geofenceRadiusM = radius.toFixed(2);
          }

          if (storeErrors.length > 0) {
            errors.push(...storeErrors);
          } else {
            planned = {
              storeNo: storeNoRaw,
              name: deriveStoreName(nameSource, storeNoRaw),
              area: explicitArea,
              id: null,
              isNew: true,
              details: { address: tidy(raw_.address) || DEFAULT_STORE_ADDRESS, latitude, longitude, geofenceRadiusM, defaultLocation },
            };
            storeByKey.set(storeNoRaw.toLowerCase(), planned);
          }
        }
      }
      if (planned) homeStore = planned;
    }

    // ── Effective area ──
    const existingArea = existing?.areaId != null ? (areaById.get(existing.areaId) ?? null) : null;
    let area: PlannedArea | null;
    if (areaExplicit) {
      area = explicitArea;
      if (explicitArea && storeExplicit && homeStore && homeStore.area !== explicitArea) {
        errors.push(`Area Name "${areaNameRaw}" does not match Store No "${storeNoRaw}"'s actual area (${homeStore.area.name}).`);
      }
    } else if (storeExplicit) {
      area = homeStore ? homeStore.area : (action === 'update' ? existingArea : null);
    } else {
      area = action === 'update' ? existingArea : null;
    }

    // ── ops_area single-owner rule ──
    if (employeeTypeCode === 'ops_area' && area) {
      const claimant = opsAreaClaims.get(area);
      if (claimant && claimant !== nik) {
        const claimantName = existingByNik.get(claimant)?.name ?? claimant;
        errors.push(`Area "${area.name}" is already assigned to OPS Area user "${claimantName}" (${claimant}); unassign them first.`);
      }
    }

    // ── Password ──
    const passwordRaw = raw_.password.trim();
    let passwordToSet: string | undefined;
    if (passwordRaw) {
      const pwPolicy = validateNewPassword(passwordRaw);
      if (!pwPolicy.ok) {
        errors.push(pwPolicy.error);
      } else {
        passwordToSet = passwordRaw;
      }
    } else if (action === 'create') {
      passwordToSet = DEFAULT_PASSWORD;
      warnings.push(`No password provided — defaulted to "${DEFAULT_PASSWORD}". Ask the user to change it on first login.`);
    }

    // ── Active ──
    const activeRaw = raw_.active.trim();
    let isActive: boolean;
    if (activeRaw === '') {
      isActive = action === 'update' && existing ? existing.isActive : true;
    } else {
      const parsedActive = parseActiveFlag(activeRaw);
      if (parsedActive == null) {
        errors.push(`Active/Status value "${raw_.active}" not recognized — use TRUE/FALSE or AKTIF/Resign.`);
        isActive = true;
      } else {
        isActive = parsedActive;
      }
    }

    const status: 'ok' | 'error' = errors.length > 0 ? 'error' : 'ok';

    // ── Nothing to do for an existing user whose values already match ──
    const sameRef = <T extends { id: number | null }>(planned: T | null, existingId: number | null) =>
      planned == null ? existingId == null : planned.id != null && planned.id === existingId;
    if (
      status === 'ok' && action === 'update' && existing && !passwordToSet
      && name === existing.name
      && roleId === existing.roleId
      && (employeeTypeId ?? null) === existing.employeeTypeId
      && sameRef(homeStore, existing.homeStoreId)
      && sameRef(area, existing.areaId)
      && isActive === existing.isActive
    ) {
      action = 'unchanged';
    }

    if (status === 'ok' && action !== 'unchanged') {
      // Claim the area for this file's remaining rows (only once validated ok).
      if (employeeTypeCode === 'ops_area' && area) opsAreaClaims.set(area, nik);
      if (homeStore?.isNew) neededStores.add(homeStore);
      if (homeStore?.isNew && homeStore.area.isNew) neededAreas.add(homeStore.area);
      if (area?.isNew) neededAreas.add(area);
    }

    if (homeStore?.isNew) notes.push(`New store: ${homeStore.storeNo} — ${homeStore.name}`);
    if (area?.isNew) notes.push(`New area: ${area.name}`);

    const result: UserImportRowResult = { row: raw_.excelRow, nik, name, action, status, errors, warnings, notes };
    results.push(result);

    if (opts.commit && status === 'ok' && action !== 'unchanged') {
      try {
        const homeStoreId = homeStore ? await ensureStore(homeStore) : null;
        const areaId = area ? await ensureArea(area) : null;

        if (action === 'create') {
          const hashed = await bcrypt.hash(passwordToSet ?? DEFAULT_PASSWORD, SALT_ROUNDS);
          const [createdUser] = await db
            .insert(users)
            .values({
              nik, name, password: hashed,
              roleId: roleId!, employeeTypeId: employeeTypeId ?? null,
              homeStoreId, areaId, isActive,
            })
            .returning({ id: users.id });

          if (homeStoreId != null) {
            await setUserHomeStore({
              userId: createdUser.id, homeStoreId, areaId,
              roleId: roleId!, employeeTypeId: employeeTypeId ?? null,
              assignedBy: opts.assignedBy, notes: 'Created via Excel import.',
            });
          }
        } else if (existing) {
          const updates: Partial<typeof users.$inferInsert> = { name, isActive, updatedAt: new Date() };
          if (passwordToSet) {
            updates.password = await bcrypt.hash(passwordToSet, SALT_ROUNDS);
            updates.passwordChangedAt = new Date();
          }

          const storeOrAreaChanged = storeExplicit || areaExplicit;
          if (storeOrAreaChanged) {
            await setUserHomeStore({
              userId: existing.id, homeStoreId, areaId,
              roleId: roleId!, employeeTypeId: employeeTypeId ?? null,
              assignedBy: opts.assignedBy, notes: 'Updated via Excel import.',
            });
          } else {
            updates.roleId = roleId!;
            updates.employeeTypeId = employeeTypeId ?? null;
          }

          await db.update(users).set(updates).where(eq(users.id, existing.id));
        }
        result.committed = true;
      } catch (err) {
        result.errors.push(`Write failed: ${err instanceof Error ? err.message : String(err)}`);
        result.committed = false;
      }
    }
  }

  const toCreate = results.filter((r) => r.status === 'ok' && r.action === 'create').length;
  const toUpdate = results.filter((r) => r.status === 'ok' && r.action === 'update').length;
  const unchanged = results.filter((r) => r.status === 'ok' && r.action === 'unchanged').length;
  const invalid = results.filter((r) => r.status === 'error').length;
  const created = results.filter((r) => r.committed && r.action === 'create').length;
  const updated = results.filter((r) => r.committed && r.action === 'update').length;
  const failed = results.filter((r) => opts.commit && r.status === 'ok' && r.action !== 'unchanged' && !r.committed).length;

  return {
    totalRows: results.length, toCreate, toUpdate, unchanged, invalid, created, updated, failed,
    newAreas: [...neededAreas].map((a) => a.name),
    newStores: [...neededStores].map((s) => ({
      storeNo: s.storeNo, name: s.name, areaName: s.area.name, defaultLocation: s.details?.defaultLocation ?? false,
    })),
    areasCreated, storesCreated,
    rows: results,
  };
}
