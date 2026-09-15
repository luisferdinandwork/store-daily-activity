// lib/user-import.ts
//
// Bulk Users Excel import — parse, validate, (optionally) commit.
//
// Mirrors lib/schedule-import.ts's "collect errors, don't abort" philosophy,
// but this is a flat table (one row per user) so parsing is header-name
// based rather than position/anchor based.
//
// Flow: parseUsersWorkbook() turns a workbook into flat rows (or a hard
// headerError if the required columns can't be found at all), then
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
import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes, stores, areas } from '@/lib/db/schema';
import { setUserHomeStore } from '@/lib/db/utils/user-store-assignment';

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'password123'; // matches this repo's seed convention, see CLAUDE.md

// Employee type code → the role code it's only valid under.
const EMP_TYPE_ROLE_CODE: Record<string, string> = {
  pic_1: 'employee',
  pic_2: 'employee',
  sa: 'employee',
  ops_ho: 'ops',
  ops_area: 'ops',
};

// ─── Column definitions (shared with the template generator) ────────────────

export interface UserImportColumnDef {
  key: 'nik' | 'name' | 'roleCode' | 'employeeTypeCode' | 'storeNo' | 'areaName' | 'password' | 'active';
  label: string;
  required: boolean;
  aliases: string[];
}

export const USER_IMPORT_COLUMNS: UserImportColumnDef[] = [
  { key: 'nik', label: 'NIK', required: true, aliases: ['nik'] },
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'nama'] },
  { key: 'roleCode', label: 'Role Code', required: true, aliases: ['role code', 'rolecode', 'role'] },
  { key: 'employeeTypeCode', label: 'Employee Type Code', required: false, aliases: ['employee type code', 'employeetypecode', 'employee type'] },
  { key: 'storeNo', label: 'Store No', required: false, aliases: ['store no', 'storeno', 'store number', 'store code'] },
  { key: 'areaName', label: 'Area Name', required: false, aliases: ['area name', 'areaname', 'area'] },
  { key: 'password', label: 'Password', required: false, aliases: ['password'] },
  { key: 'active', label: 'Active', required: false, aliases: ['active', 'is active', 'status'] },
];

// ─── Parsing ──────────────────────────────────────────────────────────────────

export interface RawUserImportRow {
  excelRow: number;
  nik: string;
  name: string;
  roleCode: string;
  employeeTypeCode: string;
  storeNo: string;
  areaName: string;
  password: string;
  active: string;
}

export type ParseUsersResult = { rows: RawUserImportRow[] } | { headerError: string };

export function parseUsersWorkbook(buffer: ArrayBuffer): ParseUsersResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'users') ?? wb.SheetNames[0];
  if (!sheetName) return { headerError: 'The uploaded file has no sheets.' };

  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: false, defval: '' });

  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

  let headerRowIdx = -1;
  let colIndex: Partial<Record<UserImportColumnDef['key'], number>> = {};

  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const found: Partial<Record<UserImportColumnDef['key'], number>> = {};
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

  if (headerRowIdx === -1) {
    const requiredLabels = USER_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.label).join(', ');
    return {
      headerError:
        `Could not find a header row with the required columns (${requiredLabels}) in sheet "${sheetName}". ` +
        `Make sure you're using the "Users" sheet from the downloaded template without renaming its column headers.`,
    };
  }

  const rows: RawUserImportRow[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (key: UserImportColumnDef['key']) => {
      const idx = colIndex[key];
      return idx === undefined ? '' : String(cells[idx] ?? '').trim();
    };

    const row: RawUserImportRow = {
      excelRow: r + 1,
      nik: get('nik'),
      name: get('name'),
      roleCode: get('roleCode'),
      employeeTypeCode: get('employeeTypeCode'),
      storeNo: get('storeNo'),
      areaName: get('areaName'),
      password: get('password'),
      active: get('active'),
    };

    const isBlank = Object.values(row).every((v, i) => i === 0 /* excelRow */ || v === '');
    if (isBlank) continue;

    rows.push(row);
  }

  return { rows };
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
  action: 'create' | 'update';
  status: 'ok' | 'error';
  errors: string[];
  warnings: string[];
  /** Only meaningful when the report was built with commit:true. */
  committed?: boolean;
}

export interface UserImportReport {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  invalid: number;
  created: number;
  updated: number;
  failed: number;
  rows: UserImportRowResult[];
}

export async function buildUserImportReport(
  raw: RawUserImportRow[],
  lookups: UserImportLookups,
  opts: { commit: boolean; assignedBy: string },
): Promise<UserImportReport> {
  const roleByCode = new Map(lookups.roles.map((r) => [r.code.toLowerCase(), r]));
  const roleById = new Map(lookups.roles.map((r) => [r.id, r]));
  const empTypeByCode = new Map(lookups.employeeTypes.map((t) => [t.code.toLowerCase(), t]));
  const storeByNo = new Map(lookups.stores.map((s) => [s.storeNo.toLowerCase(), s]));
  const areaByName = new Map(lookups.areas.map((a) => [a.name.toLowerCase(), a]));
  const existingByNik = new Map(lookups.existingUsers.map((u) => [u.nik, u]));

  // areaId -> nik of the current ops_area holder (seeded from DB, updated as
  // rows in this file claim areas — mirrors the 1:1 rule enforced by
  // /api/ops/areas/[id]/assign, surfaced here as validation instead of
  // silent displacement).
  const opsAreaTypeId = empTypeByCode.get('ops_area')?.id;
  const opsAreaClaims = new Map<number, string>();
  if (opsAreaTypeId != null) {
    for (const u of lookups.existingUsers) {
      if (u.employeeTypeId === opsAreaTypeId && u.areaId != null && u.isActive) {
        opsAreaClaims.set(u.areaId, u.nik);
      }
    }
  }

  const seenNiks = new Map<string, number>(); // lowercased nik -> first excelRow seen
  const results: UserImportRowResult[] = [];

  for (const raw_ of raw) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const nik = raw_.nik.trim();
    const name = raw_.name.trim();

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
      results.push({ row: raw_.excelRow, nik, name, action: 'create', status: 'error', errors, warnings });
      continue;
    }

    const existing = existingByNik.get(nik);
    const action: 'create' | 'update' = existing ? 'update' : 'create';

    // ── Role ──
    const roleCodeRaw = raw_.roleCode.trim();
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
    } else {
      errors.push('Role Code is required for new users.');
    }

    // ── Employee type ──
    const empTypeCodeRaw = raw_.employeeTypeCode.trim();
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

    // ── Store ──
    const storeNoRaw = raw_.storeNo.trim();
    const storeExplicit = storeNoRaw !== '';
    let homeStoreId: number | null;
    let storeAreaId: number | null = null;
    if (storeExplicit) {
      if (storeNoRaw.toUpperCase() === 'NONE') {
        homeStoreId = null;
      } else {
        const store = storeByNo.get(storeNoRaw.toLowerCase());
        if (!store) {
          errors.push(`Store No "${storeNoRaw}" was not found.`);
          homeStoreId = action === 'update' && existing ? existing.homeStoreId : null;
        } else {
          homeStoreId = store.id;
          storeAreaId = store.areaId;
        }
      }
    } else {
      homeStoreId = action === 'update' && existing ? existing.homeStoreId : null;
    }

    // ── Area ──
    const areaNameRaw = raw_.areaName.trim();
    const areaExplicit = areaNameRaw !== '';
    let areaId: number | null;
    if (areaExplicit) {
      if (areaNameRaw.toUpperCase() === 'NONE') {
        areaId = null;
      } else {
        const area = areaByName.get(areaNameRaw.toLowerCase());
        if (!area) {
          errors.push(`Area Name "${areaNameRaw}" was not found.`);
          areaId = action === 'update' && existing ? existing.areaId : null;
        } else {
          areaId = area.id;
          if (storeExplicit && storeAreaId != null && storeAreaId !== area.id) {
            errors.push(`Area Name "${areaNameRaw}" does not match Store No "${storeNoRaw}"'s actual area.`);
          }
        }
      }
    } else if (storeExplicit) {
      areaId = homeStoreId != null ? storeAreaId : (action === 'update' && existing ? existing.areaId : null);
    } else {
      areaId = action === 'update' && existing ? existing.areaId : null;
    }

    // ── ops_area single-owner rule ──
    if (employeeTypeCode === 'ops_area' && areaId != null) {
      const claimant = opsAreaClaims.get(areaId);
      if (claimant && claimant !== nik) {
        const claimantName = existingByNik.get(claimant)?.name ?? claimant;
        const areaLabel = lookups.areas.find((a) => a.id === areaId)?.name ?? String(areaId);
        errors.push(`Area "${areaLabel}" is already assigned to OPS Area user "${claimantName}" (${claimant}); unassign them first.`);
      }
    }

    // ── Password ──
    const passwordRaw = raw_.password.trim();
    let passwordToSet: string | undefined;
    if (passwordRaw) {
      if (passwordRaw.length < 6) {
        errors.push('Password must be at least 6 characters.');
      } else {
        passwordToSet = passwordRaw;
      }
    } else if (action === 'create') {
      passwordToSet = DEFAULT_PASSWORD;
      warnings.push(`No password provided — defaulted to "${DEFAULT_PASSWORD}". Ask the user to change it on first login.`);
    }

    // ── Active ──
    const activeRaw = raw_.active.trim().toLowerCase();
    const TRUE_SET = new Set(['true', '1', 'yes', 'y', 'active', 'aktif']);
    const FALSE_SET = new Set(['false', '0', 'no', 'n', 'inactive', 'nonaktif']);
    let isActive: boolean;
    if (activeRaw === '') {
      isActive = action === 'update' && existing ? existing.isActive : true;
    } else if (TRUE_SET.has(activeRaw)) {
      isActive = true;
    } else if (FALSE_SET.has(activeRaw)) {
      isActive = false;
    } else {
      errors.push(`Active value "${raw_.active}" not recognized — use TRUE or FALSE.`);
      isActive = true;
    }

    const status: 'ok' | 'error' = errors.length > 0 ? 'error' : 'ok';

    // Claim the area for this file's remaining rows (only once validated ok).
    if (status === 'ok' && employeeTypeCode === 'ops_area' && areaId != null) {
      opsAreaClaims.set(areaId, nik);
    }

    const result: UserImportRowResult = { row: raw_.excelRow, nik, name, action, status, errors, warnings };
    results.push(result);

    if (opts.commit && status === 'ok') {
      try {
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
  const invalid = results.filter((r) => r.status === 'error').length;
  const created = results.filter((r) => r.committed && r.action === 'create').length;
  const updated = results.filter((r) => r.committed && r.action === 'update').length;
  const failed = results.filter((r) => opts.commit && r.status === 'ok' && !r.committed).length;

  return { totalRows: results.length, toCreate, toUpdate, invalid, created, updated, failed, rows: results };
}
