// scripts/seed/setup.ts
//
// Idempotent setup seed — the structural skeleton the dev/staging database
// needs before every other seed step.
//
// The world it builds is defined in scripts/seed/dataset.ts:
//   • areas   — DKI - BALI, DUMMY AREA
//   • stores  — FF001 (Fisik Football), FO001 (Factory Outlet), DUMMY-001
//               (all at the Daan Mogot geofence)
//   • store rosters — real employees transcribed from the Sep 2026 break-down
//     sheets, with their job level mapped to an employee_type
//     (PIC 1 → pic_1, PIC 2 → pic_2, SA → sa).
//   • back-office accounts — OPS HO, OPS DKI - Bali (Indriawan), Dummy Ops,
//     Finance, IT, Audit.
//
// Performance targets and schedules for September 2026 are seeded by the
// later steps (performance-targets.ts, schedules.ts) from the same dataset.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import { db } from '@/lib/db';
import {
  areas,
  employeeTypes,
  shifts,
  storeBins,
  stores,
  userRoles,
  users,
  userStoreAssignments,
} from '@/lib/db/schema';
import { AREAS, BACK_OFFICE_USERS, STORES } from './dataset';

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'password123';

function makeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// ─── get-or-create helpers ──────────────────────────────────────────────────

async function getOrCreateRole(values: typeof userRoles.$inferInsert) {
  const [existing] = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.code, values.code))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(userRoles).values(values).returning();
  return created;
}

async function getOrCreateEmployeeType(
  values: typeof employeeTypes.$inferInsert,
) {
  const [existing] = await db
    .select()
    .from(employeeTypes)
    .where(eq(employeeTypes.code, values.code))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(employeeTypes).values(values).returning();
  return created;
}

async function getOrCreateShift(values: typeof shifts.$inferInsert) {
  const [existing] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.code, values.code))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(shifts).values(values).returning();
  return created;
}

async function getOrCreateArea(name: string) {
  const [existing] = await db
    .select()
    .from(areas)
    .where(eq(areas.name, name))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(areas).values({ name }).returning();
  return created;
}

async function getOrCreateStore(values: typeof stores.$inferInsert) {
  const [existing] = await db
    .select()
    .from(stores)
    .where(eq(stores.storeNo, values.storeNo))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(stores).values(values).returning();
  return created;
}

async function getOrCreateUser(values: typeof users.$inferInsert) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.nik, values.nik))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(users).values(values).returning();
  return created;
}

async function createUserStoreAssignmentIfMissing(
  values: typeof userStoreAssignments.$inferInsert,
) {
  const [existing] = await db
    .select()
    .from(userStoreAssignments)
    .where(
      and(
        eq(userStoreAssignments.userId, values.userId),
        eq(userStoreAssignments.storeId, values.storeId),
        eq(userStoreAssignments.isActive, true),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(userStoreAssignments)
    .values(values)
    .returning();

  return created;
}

async function createStoreBinIfMissing(values: typeof storeBins.$inferInsert) {
  const [existing] = await db
    .select()
    .from(storeBins)
    .where(and(eq(storeBins.storeId, values.storeId), eq(storeBins.bin, values.bin)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(storeBins).values(values).returning();
  return created;
}

// ─── Lookup tables (roles / employee types / shifts) ────────────────────────

export interface SeedLookupIds {
  roleId: Record<string, number>;
  empTypeId: Record<string, number>;
  shiftId: Record<string, number>;
}

/**
 * Seeds the pure lookup tables — user_roles, employee_types, shifts — that
 * EVERY environment needs. Used by the full dev seed (seedSetup below) and by
 * the production seed (scripts/seed/production.ts). Idempotent.
 */
export async function seedLookups(): Promise<SeedLookupIds> {
  console.log('📋  Seeding lookup tables…');

  const insertedRoles = await Promise.all([
    getOrCreateRole({
      code: 'employee',
      label: 'Employee',
      description: 'Store-level staff',
      sortOrder: 10,
    }),
    getOrCreateRole({
      code: 'ops',
      label: 'Operations',
      description: 'Area operations manager',
      canReceiveIssues: true,
      sortOrder: 20,
    }),
    getOrCreateRole({
      code: 'finance',
      label: 'Finance',
      description: 'Finance team',
      canReceiveIssues: true,
      sortOrder: 30,
    }),
    getOrCreateRole({
      code: 'it',
      label: 'IT',
      description: 'System administrator — full access, can preview other roles',
      canReceiveIssues: true,
      sortOrder: 40,
    }),
    getOrCreateRole({
      code: 'audit',
      label: 'Audit',
      description: 'Audit team',
      canReceiveIssues: true,
      sortOrder: 35,
    }),
  ]);

  const insertedEmpTypes = await Promise.all([
    getOrCreateEmployeeType({
      code: 'ops_ho',
      label: 'OPS HO',
      description: 'Head office operations user — can view all stores',
      sortOrder: 5,
    }),
    getOrCreateEmployeeType({
      code: 'ops_area',
      label: 'OPS Area',
      description: 'Area operations user — can view stores only in assigned area',
      sortOrder: 10,
    }),
    getOrCreateEmployeeType({
      code: 'pic_1',
      label: 'PIC 1',
      description: 'Person in charge — primary',
      sortOrder: 20,
    }),
    getOrCreateEmployeeType({
      code: 'pic_2',
      label: 'PIC 2',
      description: 'Person in charge — secondary',
      sortOrder: 30,
    }),
    getOrCreateEmployeeType({
      code: 'sa',
      label: 'SA',
      description: 'Sales Associate',
      sortOrder: 40,
    }),
  ]);

  // Insert sequentially, not via Promise.all: several server modules cache the
  // shift id per code (lib/db/utils/shift-lookup.ts, store-opening.ts, tasks.ts),
  // and racing the inserts makes the id→code mapping non-deterministic between
  // seed runs. Sequential inserts keep morning=1, evening=2, full_day=3.
  const insertedShifts = [
    await getOrCreateShift({
      code: 'morning',
      label: 'Morning',
      description: 'Morning opening shift',
      startTime: '07:00:00',
      endTime: '15:00:00',
      accent: 'amber',
      icon: 'sun',
      breaks: [{ type: 'lunch', label: 'Lunch', accent: 'amber' }],
      sortOrder: 10,
    }),
    await getOrCreateShift({
      code: 'evening',
      label: 'Evening',
      description: 'Evening closing shift',
      startTime: '15:00:00',
      endTime: '23:00:00',
      accent: 'violet',
      icon: 'moon',
      breaks: [{ type: 'dinner', label: 'Dinner', accent: 'violet' }],
      sortOrder: 20,
    }),
    await getOrCreateShift({
      code: 'full_day',
      label: 'Full Day',
      description: 'Full day shift covering opening and closing tasks',
      startTime: '07:00:00',
      endTime: '23:00:00',
      accent: 'sky',
      icon: 'zap',
      breaks: [
        {
          type: 'full_day_lunch',
          label: 'Lunch (Full Day)',
          accent: 'amber',
        },
        {
          type: 'full_day_dinner',
          label: 'Dinner (Full Day)',
          accent: 'violet',
        },
      ],
      sortOrder: 30,
    }),
  ];

  const roleId = Object.fromEntries(insertedRoles.map((r) => [r.code, r.id])) as
    Record<string, number>;

  const empTypeId = Object.fromEntries(
    insertedEmpTypes.map((r) => [r.code, r.id]),
  ) as Record<string, number>;

  const shiftId = Object.fromEntries(
    insertedShifts.map((s) => [s.code, s.id]),
  ) as Record<string, number>;

  console.log(
    `✓   ${insertedRoles.length} roles, ${insertedEmpTypes.length} employee types, ${insertedShifts.length} shifts\n`,
  );

  return { roleId, empTypeId, shiftId };
}

// ─── Full setup ─────────────────────────────────────────────────────────────

export async function seedSetup() {
  console.log('🌱  seed-setup: idempotent setup seed\n');
  console.log('🛡️   Existing rows are kept. Missing rows are created only.\n');

  // ── 1. LOOKUP TABLES ──────────────────────────────────────────────────────
  const { roleId, empTypeId } = await seedLookups();

  // ── 2. AREAS ──────────────────────────────────────────────────────────────
  console.log('🗺️   Creating operational areas…');
  const areaIdByName: Record<string, number> = {};
  for (const name of AREAS) {
    const area = await getOrCreateArea(name);
    areaIdByName[name] = area.id;
    console.log(`✓   ${name} = ${area.id}`);
  }
  console.log('');

  // ── 3. STORES + BINS ──────────────────────────────────────────────────────
  console.log('🏪  Creating stores…');
  const storeIdByNo: Record<string, number> = {};

  for (const s of STORES) {
    const store = await getOrCreateStore({
      storeNo: s.storeNo,
      name: s.name,
      address: s.address,
      areaId: areaIdByName[s.areaName],
      latitude: s.latitude,
      longitude: s.longitude,
      geofenceRadiusM: s.geofenceRadiusM,
      pettyCashBalance: s.pettyCashBalance,
    });
    storeIdByNo[s.storeNo] = store.id;

    const binRows = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const qtyBc = 20 + ((n * 3) % 25);
      const qtyTidakSesuaiBin = n % 5 === 0 ? 1 : 0;
      return {
        storeId: store.id,
        bin: `BIN-${String(n).padStart(2, '0')}`,
        qtyBc,
        qtySesuaiBin: Math.max(qtyBc - qtyTidakSesuaiBin, 0),
        qtyTidakSesuaiBin,
        nama: `Bin ${n}`,
        isActive: true,
      };
    });
    for (const row of binRows) await createStoreBinIfMissing(row);

    console.log(`✓   ${s.storeNo}  ${s.name}  (area ${s.areaName}, ${s.employees.length} staff)`);
  }
  console.log('');

  // ── 4. BACK-OFFICE ACCOUNTS ───────────────────────────────────────────────
  console.log('👤  Creating back-office accounts…');
  const pwd = await hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  for (const def of BACK_OFFICE_USERS) {
    await getOrCreateUser({
      id: def.id,
      nik: def.nik,
      name: def.name,
      password: pwd,
      roleId: roleId[def.roleCode],
      employeeTypeId: def.empTypeCode ? empTypeId[def.empTypeCode] : null,
      homeStoreId: null,
      areaId: def.areaName ? areaIdByName[def.areaName] : null,
      isActive: true,
    });
    console.log(`✓   ${def.nik.padEnd(18)} ${def.name}`);
  }
  console.log('');

  // ── 5. STORE EMPLOYEES + ASSIGNMENT HISTORY ───────────────────────────────
  console.log('👥  Creating store employees…');
  let empN = 0;

  for (const s of STORES) {
    const storeId = storeIdByNo[s.storeNo];
    for (const emp of s.employees) {
      empN += 1;
      const employeeTypeId = empTypeId[emp.empType];

      const row = await getOrCreateUser({
        id: makeId('EMP', empN),
        nik: emp.nik,
        name: emp.name,
        password: pwd,
        roleId: roleId.employee,
        employeeTypeId,
        homeStoreId: storeId,
        areaId: null,
        isActive: true,
      });

      await createUserStoreAssignmentIfMissing({
        userId: row.id,
        storeId,
        areaId: areaIdByName[s.areaName],
        roleId: roleId.employee,
        employeeTypeId,
        isActive: true,
        notes: 'Initial seed assignment',
      });

      const label = emp.empType === 'pic_1' ? 'PIC 1' : emp.empType === 'pic_2' ? 'PIC 2' : 'SA';
      console.log(`✓   ${s.storeNo}  ${row.id}  NIK=${emp.nik.padEnd(12)} ${label.padEnd(6)} ${emp.name}`);
    }
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log(`    ${AREAS.length} areas · ${STORES.length} stores · ${BACK_OFFICE_USERS.length} back-office accounts · ${empN} store employees`);
  console.log(`🔐  Default password for newly created users: ${DEFAULT_PASSWORD}`);
  console.log('🔑  Login uses NIK, not email.');
  console.log('═══════════════════════════════════════════════════════════');
}
