// scripts/seed/setup.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import { db } from '@/lib/db';
import {
  areas,
  businessCentralSettings,
  employeeMonthlyTargets,
  employeeTypes,
  shifts,
  storeBins,
  storeMonthlyTargets,
  stores,
  userRoles,
  users,
  userStoreAssignments,
} from '@/lib/db/schema';

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'password123';
const TARGET_YEAR_MONTH =
  process.env.SEED_TARGET_YEAR_MONTH ?? new Date().toISOString().slice(0, 7);

function makeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

function cleanEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

function calculateAtvTarget(salesTarget: number, transactionTarget: number) {
  if (!transactionTarget || transactionTarget <= 0) return 0;
  return Math.round(salesTarget / transactionTarget);
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

function normalizeStatusToEmployeeTypeCode(
  status: string,
): 'pic_1' | 'pic_2' | 'sa' {
  const upper = status.trim().toUpperCase();

  if (upper === 'PIC 1' || upper === 'PIC1') return 'pic_1';
  if (upper === 'PIC 2' || upper === 'PIC2') return 'pic_2';

  return 'sa';
}

function targetRoleFromStatus(status: string): {
  roleCode: 'PIC1' | 'PIC2' | 'SA';
  weightPct: number;
} {
  const upper = status.trim().toUpperCase();

  if (upper === 'PIC 1' || upper === 'PIC1') {
    return { roleCode: 'PIC1', weightPct: 10 };
  }

  if (upper === 'PIC 2' || upper === 'PIC2') {
    return { roleCode: 'PIC2', weightPct: 10 };
  }

  return { roleCode: 'SA', weightPct: 100 };
}

function applyTargetWeight(baseTarget: number, weightPct: number) {
  return Math.round((baseTarget * weightPct) / 100);
}

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

async function getOrCreateArea(values: typeof areas.$inferInsert) {
  const [existing] = await db
    .select()
    .from(areas)
    .where(eq(areas.name, values.name))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(areas).values(values).returning();
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

async function createBusinessCentralSettingsIfMissing() {
  const apiUrl = cleanEnv(process.env.BC_SALES_ENTRIES_URL);
  const username = cleanEnv(process.env.BC_API_USERNAME ?? process.env.BC_USERNAME);
  const password = cleanEnv(process.env.BC_API_PASSWORD ?? process.env.BC_PASSWORD);
  const bearerToken = cleanEnv(process.env.BC_API_BEARER_TOKEN);

  if (!apiUrl) {
    console.log('ℹ️   BC settings skipped: BC_SALES_ENTRIES_URL is empty.');
    return null;
  }

  const [existing] = await db
    .select()
    .from(businessCentralSettings)
    .where(eq(businessCentralSettings.code, 'sales_entries'))
    .limit(1);

  if (existing) {
    console.log('✓   BC settings already exist, skipped.');
    return existing;
  }

  if (!bearerToken && (!username || !password)) {
    console.log(
      'ℹ️   BC settings skipped: missing BC_API_USERNAME/BC_API_PASSWORD or BC_API_BEARER_TOKEN.',
    );
    return null;
  }

  const [created] = await db
    .insert(businessCentralSettings)
    .values({
      code: 'sales_entries',
      name: 'Business Central Sales Entries',
      apiUrl,
      username: bearerToken ? null : username,
      password: bearerToken ? null : password,
      bearerToken: bearerToken || null,
      authType: bearerToken ? 'bearer' : 'basic',
      isActive: true,
    })
    .returning();

  console.log('✓   BC settings created from .env.local.');
  return created;
}

async function createStoreTargetPlanIfMissing(
  values: typeof storeMonthlyTargets.$inferInsert,
) {
  const [existing] = await db
    .select()
    .from(storeMonthlyTargets)
    .where(
      and(
        eq(storeMonthlyTargets.storeId, values.storeId),
        eq(storeMonthlyTargets.yearMonth, values.yearMonth),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(storeMonthlyTargets)
    .values(values)
    .returning();

  return created;
}

async function createEmployeeTargetIfMissing(
  values: typeof employeeMonthlyTargets.$inferInsert,
) {
  const [existing] = await db
    .select()
    .from(employeeMonthlyTargets)
    .where(
      and(
        eq(employeeMonthlyTargets.userId, values.userId),
        eq(employeeMonthlyTargets.storeId, values.storeId),
        eq(employeeMonthlyTargets.yearMonth, values.yearMonth),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(employeeMonthlyTargets)
    .values(values)
    .returning();

  return created;
}

export async function seedSetup() {
  console.log('🌱  seed-setup: idempotent setup seed\n');

  console.log(
    '🛡️   Existing data will be kept. Missing rows will be created only.\n',
  );

  // ── 1. LOOKUP TABLES ──────────────────────────────────────────────────────
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

  const insertedShifts = await Promise.all([
    getOrCreateShift({
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
    getOrCreateShift({
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
    getOrCreateShift({
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
  ]);

  const roleId = Object.fromEntries(insertedRoles.map((r) => [r.code, r.id])) as
    Record<string, number>;

  const empTypeId = Object.fromEntries(
    insertedEmpTypes.map((r) => [r.code, r.id]),
  ) as Record<string, number>;

  console.log(
    `✓   ${insertedRoles.length} roles, ${insertedEmpTypes.length} employee types, ${insertedShifts.length} shifts\n`,
  );

  // ── 2. AREAS ──────────────────────────────────────────────────────────────
  console.log('🗺️   Creating operational area groups…');

  const [areaDkiBali, areaJabarSumatera] = await Promise.all([
    getOrCreateArea({ name: 'DKI - BALI' }),
    getOrCreateArea({ name: 'JAWA BARAT - SUMATERA' }),
  ]);

  console.log(
    `✓   Areas ready: DKI - BALI=${areaDkiBali.id}, JAWA BARAT - SUMATERA=${areaJabarSumatera.id}\n`,
  );

  // ── 3. STORES ─────────────────────────────────────────────────────────────
  console.log('🏪  Creating stores…');

  const [storeFF001, storeFS033, storeFF012, storeFS020] = await Promise.all([
    getOrCreateStore({
      storeNo: 'FF001',
      name: 'Fisik Football - Daan Mogot',
      address: 'DKI · Daan Mogot, DKI Jakarta',
      areaId: areaDkiBali.id,
      latitude: '-6.1630687',
      longitude: '106.7739266',
      geofenceRadiusM: '150',
      pettyCashBalance: '1000000',
    }),
    getOrCreateStore({
      storeNo: 'FS033',
      name: 'Fisik - Living World Denpasar',
      address: 'BALI · Living World Denpasar, Bali',
      areaId: areaDkiBali.id,
      latitude: '-8.6500000',
      longitude: '115.2166670',
      geofenceRadiusM: '150',
      pettyCashBalance: '1000000',
    }),
    getOrCreateStore({
      storeNo: 'FF012',
      name: 'Fisik Football - Summarecon Mall Bekasi',
      address: 'JAWA BARAT · Summarecon Mall Bekasi',
      areaId: areaJabarSumatera.id,
      latitude: '-6.2400000',
      longitude: '107.0000000',
      geofenceRadiusM: '150',
      pettyCashBalance: '1000000',
    }),
    getOrCreateStore({
      storeNo: 'FS020',
      name: 'Fisik - Plaza Medan Fair',
      address: 'SUMATERA · Plaza Medan Fair, Medan',
      areaId: areaJabarSumatera.id,
      latitude: '3.5900000',
      longitude: '98.6700000',
      geofenceRadiusM: '150',
      pettyCashBalance: '1000000',
    }),
  ]);

  const storeByCode = {
    FF001: storeFF001,
    FS033: storeFS033,
    FF012: storeFF012,
    FS020: storeFS020,
  } as const;

  type StoreCode = keyof typeof storeByCode;

  const storeAreaIdByStoreId = new Map<number, number>([
    [storeFF001.id, areaDkiBali.id],
    [storeFS033.id, areaDkiBali.id],
    [storeFF012.id, areaJabarSumatera.id],
    [storeFS020.id, areaJabarSumatera.id],
  ]);

  console.log(
    `✓   Stores ready: FF001=${storeFF001.id}, FS033=${storeFS033.id}, FF012=${storeFF012.id}, FS020=${storeFS020.id}\n`,
  );

  // ── 3b. STORE BINS ────────────────────────────────────────────────────────
  console.log('🗃️   Creating store bins…');

  const binRows = [storeFF001, storeFS033, storeFF012, storeFS020].flatMap(
    (store) =>
      Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        const qtyBc = 20 + ((n * 3) % 25);
        const qtyTidakSesuaiBin = n % 5 === 0 ? 1 : 0;
        const qtySesuaiBin = Math.max(qtyBc - qtyTidakSesuaiBin, 0);

        return {
          storeId: store.id,
          bin: `BIN-${String(n).padStart(2, '0')}`,
          qtyBc,
          qtySesuaiBin,
          qtyTidakSesuaiBin,
          nama: `Bin ${n}`,
          isActive: true,
        };
      }),
  );

  let createdBinCount = 0;

  for (const row of binRows) {
    const result = await createStoreBinIfMissing(row);
    if (result) createdBinCount += 1;
  }

  console.log(`✓   Store bins checked/created: ${binRows.length}\n`);

  // ── 4. USERS ──────────────────────────────────────────────────────────────
  console.log('👥  Creating users…');

  const pwd = await hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  let opsN = 0;
  let empN = 0;

  const opsId = () => makeId('OPS', ++opsN);
  const empId = () => makeId('EMP', ++empN);

  type NewUser = typeof users.$inferInsert;

  const employeeRows: Array<{
    nik: string;
    name: string;
    storeCode: StoreCode;
    status: string;
  }> = [
    {
      nik: 'A201902047',
      name: 'Bagas Dwi Cahyo',
      storeCode: 'FF001',
      status: 'PIC 1',
    },
    {
      nik: 'A202301017',
      name: 'Ratna Kemala',
      storeCode: 'FF001',
      status: 'PIC 2',
    },
    {
      nik: 'A202312196',
      name: 'M. Rifal Agustian',
      storeCode: 'FF001',
      status: 'SA 1',
    },
    {
      nik: 'A202401013',
      name: 'Salwa Adelia',
      storeCode: 'FF001',
      status: 'SA 2',
    },
    {
      nik: 'A202508100',
      name: 'Naila Naziha',
      storeCode: 'FF001',
      status: 'SA 3',
    },
    {
      nik: 'A202511141',
      name: 'Kheir Tsar Muhammad Ali',
      storeCode: 'FF001',
      status: 'SA 4',
    },
    {
      nik: 'A202511149',
      name: 'Rifqi Fahriza',
      storeCode: 'FF001',
      status: 'SA 5',
    },
    {
      nik: 'A202601008',
      name: 'Gemilang Dwi Ramadhan',
      storeCode: 'FF001',
      status: 'SA 6',
    },
    {
      nik: 'A202603040',
      name: 'Amelia',
      storeCode: 'FF001',
      status: 'SA 7',
    },

    {
      nik: 'A09030101',
      name: 'Agus Fauzi',
      storeCode: 'FS033',
      status: 'PIC 1',
    },
    {
      nik: 'A202507087',
      name: 'Muhamad Zehan Pratama',
      storeCode: 'FS033',
      status: 'PIC 2',
    },
    {
      nik: 'A202603054',
      name: 'Salsa Juliannisa Harfi Awal',
      storeCode: 'FS033',
      status: 'SA 1',
    },
    {
      nik: 'A202604074',
      name: 'Adit Paramuditiya Rahmat',
      storeCode: 'FS033',
      status: 'SA 2',
    },
    {
      nik: 'A202605072',
      name: 'Ani Pratiwi',
      storeCode: 'FS033',
      status: 'SA 3',
    },

    {
      nik: 'DUMMY-FF012-01',
      name: 'Dummy FF012 PIC 1',
      storeCode: 'FF012',
      status: 'PIC 1',
    },
    {
      nik: 'DUMMY-FF012-02',
      name: 'Dummy FF012 PIC 2',
      storeCode: 'FF012',
      status: 'PIC 2',
    },
    {
      nik: 'DUMMY-FF012-03',
      name: 'Dummy FF012 SA 1',
      storeCode: 'FF012',
      status: 'SA 1',
    },
    {
      nik: 'DUMMY-FF012-04',
      name: 'Dummy FF012 SA 2',
      storeCode: 'FF012',
      status: 'SA 2',
    },
    {
      nik: 'DUMMY-FF012-05',
      name: 'Dummy FF012 SA 3',
      storeCode: 'FF012',
      status: 'SA 3',
    },

    {
      nik: 'DUMMY-FS020-01',
      name: 'Dummy FS020 PIC 1',
      storeCode: 'FS020',
      status: 'PIC 1',
    },
    {
      nik: 'DUMMY-FS020-02',
      name: 'Dummy FS020 PIC 2',
      storeCode: 'FS020',
      status: 'PIC 2',
    },
    {
      nik: 'DUMMY-FS020-03',
      name: 'Dummy FS020 SA 1',
      storeCode: 'FS020',
      status: 'SA 1',
    },
    {
      nik: 'DUMMY-FS020-04',
      name: 'Dummy FS020 SA 2',
      storeCode: 'FS020',
      status: 'SA 2',
    },
    {
      nik: 'DUMMY-FS020-05',
      name: 'Dummy FS020 SA 3',
      storeCode: 'FS020',
      status: 'SA 3',
    },
  ];

  const userDefs: NewUser[] = [
    {
      id: opsId(),
      nik: 'OPS-HO-001',
      name: 'Dummy OPS HO',
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_ho,
      homeStoreId: null,
      areaId: null,
      isActive: true,
    },
    {
      id: opsId(),
      nik: 'OPS-DKI-BALI-001',
      name: 'Awan',
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_area,
      homeStoreId: null,
      areaId: areaDkiBali.id,
      isActive: true,
    },
    {
      id: opsId(),
      nik: 'OPS-JABAR-SUMATERA-001',
      name: 'Jayanti',
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_area,
      homeStoreId: null,
      areaId: areaJabarSumatera.id,
      isActive: true,
    },
    {
      id: 'FIN-001',
      nik: 'FIN-001',
      name: 'Finance',
      password: pwd,
      roleId: roleId.finance,
      employeeTypeId: null,   // Finance has no employee type
      homeStoreId: null,      // not tied to a single store
      areaId: null,           // sees all stores
      isActive: true,
    },
    {
      id: 'IT-001',
      nik: 'IT-001',
      name: 'IT',
      password: pwd,
      roleId: roleId.it,
      employeeTypeId: null,   // IT has no employee type
      homeStoreId: null,      // not tied to a single store
      areaId: null,           // sees all stores
      isActive: true,
    },
    {
      id: 'AUDIT-001',
      nik: 'AUDIT-001',
      name: 'Audit',
      password: pwd,
      roleId: roleId.audit,
      employeeTypeId: null,   // Audit has no employee type
      homeStoreId: null,      // not tied to a single store
      areaId: null,           // sees all stores
      isActive: true,
    },
    ...employeeRows.map((employee) => {
      const store = storeByCode[employee.storeCode];
      const employeeTypeCode = normalizeStatusToEmployeeTypeCode(
        employee.status,
      );

      return {
        id: empId(),
        nik: employee.nik,
        name: employee.name,
        password: pwd,
        roleId: roleId.employee,
        employeeTypeId: empTypeId[employeeTypeCode],
        homeStoreId: store.id,
        areaId: null,
        isActive: true,
      } satisfies NewUser;
    }),
  ];

  const insertedUsers: Array<{
    id: string;
    nik: string;
    name: string;
    roleId: number;
    employeeTypeId: number | null;
    homeStoreId: number | null;
    areaId: number | null;
  }> = [];

  for (const user of userDefs) {
    const row = await getOrCreateUser(user);

    insertedUsers.push({
      id: row.id,
      nik: row.nik,
      name: row.name,
      roleId: row.roleId,
      employeeTypeId: row.employeeTypeId,
      homeStoreId: row.homeStoreId,
      areaId: row.areaId,
    });
  }

  console.log(`✓   Users checked/created: ${insertedUsers.length}\n`);

  // ── 5. USER STORE ASSIGNMENT HISTORY ──────────────────────────────────────
  console.log('🧭  Creating user store assignment history…');

  const assignmentRows = insertedUsers
    .filter((u) => u.homeStoreId != null)
    .map((u) => ({
      userId: u.id,
      storeId: u.homeStoreId!,
      areaId: storeAreaIdByStoreId.get(u.homeStoreId!) ?? null,
      roleId: u.roleId,
      employeeTypeId: u.employeeTypeId,
      isActive: true,
      notes: 'Initial seed assignment',
    }));

  for (const row of assignmentRows) {
    await createUserStoreAssignmentIfMissing(row);
  }

  console.log(`✓   Assignment rows checked/created: ${assignmentRows.length}\n`);

  // ── 6. BUSINESS CENTRAL SETTINGS ──────────────────────────────────────────
  console.log('🔌  Creating Business Central settings…');

  await createBusinessCentralSettingsIfMissing();

  console.log('');

  // ── 7. EMPLOYEE-ROLLUP PERFORMANCE TARGETS ────────────────────────────────
  console.log(
    `🎯  Creating employee-rollup performance targets for ${TARGET_YEAR_MONTH}…`,
  );

  const storeBaseTargetDefs: Record<
    StoreCode,
    { saSalesTarget: number; saTransactionTarget: number }
  > = {
    FF001: { saSalesTarget: 45_000_000, saTransactionTarget: 180 },
    FS033: { saSalesTarget: 35_000_000, saTransactionTarget: 140 },
    FF012: { saSalesTarget: 38_000_000, saTransactionTarget: 152 },
    FS020: { saSalesTarget: 32_000_000, saTransactionTarget: 128 },
  };

  const storeTargetPlans = new Map<StoreCode, { id: number }>();

  for (const storeCode of Object.keys(storeByCode) as StoreCode[]) {
    const store = storeByCode[storeCode];

    const plan = await createStoreTargetPlanIfMissing({
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,
      targetSource: 'employee_rollup',
      notes:
        'Initial seed target plan. Store target is calculated from employee monthly targets.',
      isActive: true,
    });

    storeTargetPlans.set(storeCode, { id: plan.id });
  }

  let employeeTargetCount = 0;

  for (const employee of employeeRows) {
    const store = storeByCode[employee.storeCode];
    const user = insertedUsers.find((row) => row.nik === employee.nik);
    const plan = storeTargetPlans.get(employee.storeCode);

    if (!user || !plan) continue;

    const role = targetRoleFromStatus(employee.status);

    await createEmployeeTargetIfMissing({
      storeMonthlyTargetId: plan.id,
      userId: user.id,
      storeId: store.id,
      yearMonth: TARGET_YEAR_MONTH,

      targetRoleCode: role.roleCode,

      notes:
        role.roleCode === 'SA'
          ? 'Initial seed SA target at 100% base target.'
          : `Initial seed ${role.roleCode} target at ${role.weightPct}% of SA target.`,

      isActive: true,
    });

    employeeTargetCount += 1;
  }

  for (const storeCode of Object.keys(storeByCode) as StoreCode[]) {
    const store = storeByCode[storeCode];
    const baseTarget = storeBaseTargetDefs[storeCode];

    const storeEmployees = employeeRows.filter(
      (employee) => employee.storeCode === storeCode,
    );

    const storeSalesTarget = storeEmployees.reduce((sum, employee) => {
      const role = targetRoleFromStatus(employee.status);
      return sum + applyTargetWeight(baseTarget.saSalesTarget, role.weightPct);
    }, 0);

    const storeTransactionTarget = storeEmployees.reduce((sum, employee) => {
      const role = targetRoleFromStatus(employee.status);
      return (
        sum + applyTargetWeight(baseTarget.saTransactionTarget, role.weightPct)
      );
    }, 0);

    const storeAtvTarget = calculateAtvTarget(
      storeSalesTarget,
      storeTransactionTarget,
    );

    console.log(
      [
        `✓   ${store.storeNo} ${store.name}`,
        `${storeEmployees.length} employee targets`,
        `store rollup Rp ${money(storeSalesTarget)}`,
        `${storeTransactionTarget} trx`,
        `ATV Rp ${money(storeAtvTarget)}`,
      ].join(' · '),
    );
  }

  console.log(
    `✓   ${storeTargetPlans.size} store target plans and ${employeeTargetCount} employee targets checked/created\n`,
  );

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log('');
  console.log('🗺️   Areas & Stores:');
  console.log(`    DKI - BALI (id=${areaDkiBali.id})`);
  console.log(`      → ${storeFF001.storeNo} ${storeFF001.name} (${storeFF001.id})`);
  console.log(`      → ${storeFS033.storeNo} ${storeFS033.name} (${storeFS033.id})`);
  console.log(`    JAWA BARAT - SUMATERA (id=${areaJabarSumatera.id})`);
  console.log(`      → ${storeFF012.storeNo} ${storeFF012.name} (${storeFF012.id})`);
  console.log(`      → ${storeFS020.storeNo} ${storeFS020.name} (${storeFS020.id})`);
  console.log('');
  console.log('👤  OPS users:');
  console.log('    OPS-HO-001                 Dummy OPS HO  → OPS HO / all areas');
  console.log('    OPS-DKI-BALI-001           Awan          → OPS Area / DKI - BALI');
  console.log(
    '    OPS-JABAR-SUMATERA-001     Jayanti       → OPS Area / JAWA BARAT - SUMATERA',
  );
  console.log('💼  Finance user:');
  console.log(
    '    FIN-001                    Finance       → Finance role / all stores',
  );
  console.log('🛠️   IT user:');
  console.log(
    '    IT-001                     IT            → IT role / all stores',
  );
  console.log('🕵️   Audit user:');
  console.log(
    '    AUDIT-001                  Audit         → Audit role / all stores',
  );
  console.log('');
  console.log('👥  Users checked/created:');
  for (const u of insertedUsers) {
    console.log(`    ${u.id.padEnd(8)}  NIK=${u.nik.padEnd(24)}  ${u.name}`);
  }

  console.log('');
  console.log(`🔐  Default password for newly created users: ${DEFAULT_PASSWORD}`);
  console.log('🔑  Login uses NIK, not email.');
  console.log('═══════════════════════════════════════════════════════════');
}

