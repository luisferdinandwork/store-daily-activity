// scripts/seed-setup.ts
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { db } from "@/lib/db";
import {
  userRoles,
  employeeTypes,
  shifts,
  areas,
  stores,
  users,
  userStoreAssignments,
  monthlySchedules,
  monthlyScheduleEntries,
  schedules,
  attendance,
  breakSessions,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  setoranMoneyStorage,
  cekBinTasks,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  storeClosingTasks,
  groomingTasks,
  storeBins,
  cekBinTaskBins,
} from "@/lib/db/schema";
import { hash } from "bcryptjs";

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "password123";

function makeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

function normalizeStatusToEmployeeTypeCode(
  status: string,
): "pic_1" | "pic_2" | "sa" {
  const upper = status.trim().toUpperCase();

  if (upper === "PIC 1") return "pic_1";
  if (upper === "PIC 2") return "pic_2";

  return "sa";
}

async function seedSetup() {
  console.log("🌱  seed-setup: lookups → area groups → stores → users\n");

  // ── 0. CLEAR ALL (FK order: children → parents) ───────────────────────────
  console.log("🗑️   Clearing existing data…");

  await db.delete(breakSessions);

  await db.delete(groomingTasks);
  await db.delete(storeClosingTasks);
  await db.delete(briefingTasks);
  await db.delete(itemDroppingTasks);
  await db.delete(marketingCheckTasks);
  await db.delete(vmChecklistTasks);

  await db.delete(cekBinTaskBins);
  await db.delete(cekBinTasks);

  await db.delete(setoranMoneyStorage);
  await db.delete(setoranTasks);

  await db.delete(storeFrontTasks);
  await db.delete(storeOpeningTasks);

  await db.delete(attendance);
  await db.delete(schedules);
  await db.delete(monthlyScheduleEntries);
  await db.delete(monthlySchedules);

  await db.delete(userStoreAssignments);
  await db.delete(users);

  await db.delete(storeBins);
  await db.delete(stores);
  await db.delete(areas);

  await db.delete(shifts);
  await db.delete(employeeTypes);
  await db.delete(userRoles);

  console.log("✓   Cleared\n");

  // ── 1. LOOKUP TABLES ──────────────────────────────────────────────────────
  console.log("📋  Seeding lookup tables…");

  const insertedRoles = await db
    .insert(userRoles)
    .values([
      {
        code: "employee",
        label: "Employee",
        description: "Store-level staff",
        sortOrder: 10,
      },
      {
        code: "ops",
        label: "Operations",
        description: "Area operations manager",
        canReceiveIssues: true,
        sortOrder: 20,
      },
      {
        code: "finance",
        label: "Finance",
        description: "Finance team",
        canReceiveIssues: true,
        sortOrder: 30,
      },
      {
        code: "admin",
        label: "Admin",
        description: "System administrator",
        canReceiveIssues: true,
        sortOrder: 40,
      },
    ])
    .returning();

  const insertedEmpTypes = await db
    .insert(employeeTypes)
    .values([
      {
        code: "ops_ho",
        label: "OPS HO",
        description: "Head office operations user — can view all stores",
        sortOrder: 5,
      },
      {
        code: "ops_area",
        label: "OPS Area",
        description:
          "Area operations user — can view stores only in assigned area",
        sortOrder: 10,
      },
      {
        code: "pic_1",
        label: "PIC 1",
        description: "Person in charge — primary",
        sortOrder: 20,
      },
      {
        code: "pic_2",
        label: "PIC 2",
        description: "Person in charge — secondary",
        sortOrder: 30,
      },
      {
        code: "sa",
        label: "SA",
        description: "Sales Associate",
        sortOrder: 40,
      },
    ])
    .returning();

  const insertedShifts = await db
    .insert(shifts)
    .values([
      {
        code: "morning",
        label: "Morning",
        description: "Morning opening shift",
        startTime: "07:00:00",
        endTime: "15:00:00",
        accent: "amber",
        icon: "sun",
        breaks: [{ type: "lunch", label: "Lunch", accent: "amber" }],
        sortOrder: 10,
      },
      {
        code: "evening",
        label: "Evening",
        description: "Evening closing shift",
        startTime: "15:00:00",
        endTime: "23:00:00",
        accent: "violet",
        icon: "moon",
        breaks: [{ type: "dinner", label: "Dinner", accent: "violet" }],
        sortOrder: 20,
      },
      {
        code: "full_day",
        label: "Full Day",
        description: "Full day shift covering opening and closing tasks",
        startTime: "07:00:00",
        endTime: "23:00:00",
        accent: "sky",
        icon: "zap",
        breaks: [
          {
            type: "full_day_lunch",
            label: "Lunch (Full Day)",
            accent: "amber",
          },
          {
            type: "full_day_dinner",
            label: "Dinner (Full Day)",
            accent: "violet",
          },
        ],
        sortOrder: 30,
      },
    ])
    .returning();

  const roleId = Object.fromEntries(insertedRoles.map((r) => [r.code, r.id]));
  const empTypeId = Object.fromEntries(
    insertedEmpTypes.map((r) => [r.code, r.id]),
  );

  console.log(
    `✓   ${insertedRoles.length} roles, ${insertedEmpTypes.length} employee types, ${insertedShifts.length} shifts\n`,
  );

  // ── 2. AREAS ──────────────────────────────────────────────────────────────
  // Important:
  // - AREA is the operational area group, e.g. "DKI - BALI".
  // - SUB AREA is store location grouping, e.g. DKI, BALI, JAWA BARAT, SUMATERA.
  // - Awan and Jayanti are OPS Area users, not area names.
  console.log("🗺️   Creating operational area groups…");

  const [areaDkiBali, areaJabarSumatera] = await db
    .insert(areas)
    .values([{ name: "DKI - BALI" }, { name: "JAWA BARAT - SUMATERA" }])
    .returning();

  console.log(
    `✓   2 areas  (DKI - BALI=${areaDkiBali.id}, JAWA BARAT - SUMATERA=${areaJabarSumatera.id})\n`,
  );

  // ── 3. STORES ─────────────────────────────────────────────────────────────
  console.log("🏪  Creating stores…");

  const [storeFF001, storeFS033, storeFF012, storeFS020] = await db
    .insert(stores)
    .values([
      // 2 stores from DKI - BALI area group.
      {
        name: "FF001 - Fisik Football - Daan Mogot",
        address: "DKI · Daan Mogot, DKI Jakarta",
        areaId: areaDkiBali.id,
        latitude: "-6.1630687",
        longitude: "106.7739266",
        geofenceRadiusM: "150",
        pettyCashBalance: "1000000",
      },
      {
        name: "FS033 - Fisik - Living World Denpasar",
        address: "BALI · Living World Denpasar, Bali",
        areaId: areaDkiBali.id,
        latitude: "-8.6500000",
        longitude: "115.2166670",
        geofenceRadiusM: "150",
        pettyCashBalance: "1000000",
      },

      // 2 stores from JAWA BARAT - SUMATERA area group.
      {
        name: "FF012 - Fisik Football - Summarecon Mall Bekasi",
        address: "JAWA BARAT · Summarecon Mall Bekasi",
        areaId: areaJabarSumatera.id,
        latitude: "-6.2400000",
        longitude: "107.0000000",
        geofenceRadiusM: "150",
        pettyCashBalance: "1000000",
      },
      {
        name: "FS020 - Fisik - Plaza Medan Fair",
        address: "SUMATERA · Plaza Medan Fair, Medan",
        areaId: areaJabarSumatera.id,
        latitude: "3.5900000",
        longitude: "98.6700000",
        geofenceRadiusM: "150",
        pettyCashBalance: "1000000",
      },
    ])
    .returning();

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
    `✓   4 stores  (FF001=${storeFF001.id}, FS033=${storeFS033.id}, FF012=${storeFF012.id}, FS020=${storeFS020.id})\n`,
  );

  // ── 3b. STORE BINS ────────────────────────────────────────────────────────
  console.log("🗃️   Creating store bins…");

  const binRows = [storeFF001, storeFS033, storeFF012, storeFS020].flatMap(
    (store) =>
      Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        const qtyBc = 20 + ((n * 3) % 25);
        const qtyTidakSesuaiBin = n % 5 === 0 ? 1 : 0;
        const qtySesuaiBin = Math.max(qtyBc - qtyTidakSesuaiBin, 0);

        return {
          storeId: store.id,
          bin: `BIN-${String(n).padStart(2, "0")}`,
          qtyBc,
          qtySesuaiBin,
          qtyTidakSesuaiBin,
          nama: `Bin ${n}`,
          isActive: true,
        };
      }),
  );

  await db.insert(storeBins).values(binRows);

  console.log(`✓   ${binRows.length} store bins\n`);

  // ── 4. USERS ──────────────────────────────────────────────────────────────
  console.log("👥  Creating users…");

  const pwd = await hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  let opsN = 0;
  let empN = 0;

  const opsId = () => makeId("OPS", ++opsN);
  const empId = () => makeId("EMP", ++empN);

  type NewUser = typeof users.$inferInsert;

  const employeeRows: Array<{
    nik: string;
    name: string;
    storeCode: StoreCode;
    status: string;
  }> = [
    // Real employees from the previous DKI/BALI spreadsheet data.
    // The spreadsheet store text used "F001" for Daan Mogot, while the latest area data uses "FF001".
    {
      nik: "A201902047",
      name: "Bagas Dwi Cahyo",
      storeCode: "FF001",
      status: "PIC 1",
    },
    {
      nik: "A202301017",
      name: "Ratna Kemala",
      storeCode: "FF001",
      status: "PIC 2",
    },
    {
      nik: "A202312196",
      name: "M. Rifal Agustian",
      storeCode: "FF001",
      status: "SA 1",
    },
    {
      nik: "A202401013",
      name: "Salwa Adelia",
      storeCode: "FF001",
      status: "SA 2",
    },
    {
      nik: "A202508100",
      name: "Naila Naziha",
      storeCode: "FF001",
      status: "SA 3",
    },
    {
      nik: "A202511141",
      name: "Kheir Tsar Muhammad Ali",
      storeCode: "FF001",
      status: "SA 4",
    },
    {
      nik: "A202511149",
      name: "Rifqi Fahriza",
      storeCode: "FF001",
      status: "SA 5",
    },
    {
      nik: "A202601008",
      name: "Gemilang Dwi Ramadhan",
      storeCode: "FF001",
      status: "SA 6",
    },
    { nik: "A202603040", name: "Amelia", storeCode: "FF001", status: "SA 7" },

    {
      nik: "A09030101",
      name: "Agus Fauzi",
      storeCode: "FS033",
      status: "PIC 1",
    },
    {
      nik: "A202507087",
      name: "Muhamad Zehan Pratama",
      storeCode: "FS033",
      status: "PIC 2",
    },
    {
      nik: "A202603054",
      name: "Salsa Juliannisa Harfi Awal",
      storeCode: "FS033",
      status: "SA 1",
    },
    {
      nik: "A202604074",
      name: "Adit Paramuditiya Rahmat",
      storeCode: "FS033",
      status: "SA 2",
    },
    {
      nik: "A202605072",
      name: "Ani Pratiwi",
      storeCode: "FS033",
      status: "SA 3",
    },

    // Dummy employees because JAWA BARAT - SUMATERA employee data is not available yet.
    {
      nik: "DUMMY-FF012-01",
      name: "Dummy FF012 PIC 1",
      storeCode: "FF012",
      status: "PIC 1",
    },
    {
      nik: "DUMMY-FF012-02",
      name: "Dummy FF012 PIC 2",
      storeCode: "FF012",
      status: "PIC 2",
    },
    {
      nik: "DUMMY-FF012-03",
      name: "Dummy FF012 SA 1",
      storeCode: "FF012",
      status: "SA 1",
    },
    {
      nik: "DUMMY-FF012-04",
      name: "Dummy FF012 SA 2",
      storeCode: "FF012",
      status: "SA 2",
    },
    {
      nik: "DUMMY-FF012-05",
      name: "Dummy FF012 SA 3",
      storeCode: "FF012",
      status: "SA 3",
    },

    {
      nik: "DUMMY-FS020-01",
      name: "Dummy FS020 PIC 1",
      storeCode: "FS020",
      status: "PIC 1",
    },
    {
      nik: "DUMMY-FS020-02",
      name: "Dummy FS020 PIC 2",
      storeCode: "FS020",
      status: "PIC 2",
    },
    {
      nik: "DUMMY-FS020-03",
      name: "Dummy FS020 SA 1",
      storeCode: "FS020",
      status: "SA 1",
    },
    {
      nik: "DUMMY-FS020-04",
      name: "Dummy FS020 SA 2",
      storeCode: "FS020",
      status: "SA 2",
    },
    {
      nik: "DUMMY-FS020-05",
      name: "Dummy FS020 SA 3",
      storeCode: "FS020",
      status: "SA 3",
    },
  ];

  const userDefs: NewUser[] = [
    // OPS HO dummy user.
    {
      id: opsId(),
      nik: "OPS-HO-001",
      name: "Dummy OPS HO",
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_ho,
      homeStoreId: null,
      areaId: null,
      isActive: true,
    },

    // OPS Area users.
    {
      id: opsId(),
      nik: "OPS-DKI-BALI-001",
      name: "Awan",
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_area,
      homeStoreId: null,
      areaId: areaDkiBali.id,
      isActive: true,
    },
    {
      id: opsId(),
      nik: "OPS-JABAR-SUMATERA-001",
      name: "Jayanti",
      password: pwd,
      roleId: roleId.ops,
      employeeTypeId: empTypeId.ops_area,
      homeStoreId: null,
      areaId: areaJabarSumatera.id,
      isActive: true,
    },

    // Store employees.
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

  for (const u of userDefs) {
    const [row] = await db.insert(users).values(u).returning({
      id: users.id,
      nik: users.nik,
      name: users.name,
      roleId: users.roleId,
      employeeTypeId: users.employeeTypeId,
      homeStoreId: users.homeStoreId,
      areaId: users.areaId,
    });

    insertedUsers.push(row);
  }

  console.log(`✓   ${insertedUsers.length} users\n`);

  // ── 5. USER STORE ASSIGNMENT HISTORY ──────────────────────────────────────
  console.log("🧭  Creating user store assignment history…");

  const assignmentRows = insertedUsers
    .filter((u) => u.homeStoreId != null)
    .map((u) => ({
      userId: u.id,
      storeId: u.homeStoreId!,
      areaId: storeAreaIdByStoreId.get(u.homeStoreId!) ?? null,
      roleId: u.roleId,
      employeeTypeId: u.employeeTypeId,
      isActive: true,
      notes: "Initial seed assignment",
    }));

  if (assignmentRows.length > 0) {
    await db.insert(userStoreAssignments).values(assignmentRows);
  }

  console.log(`✓   ${assignmentRows.length} assignment rows\n`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅  seed-setup complete!");
  console.log("🗺️   Areas & Stores:");
  console.log(`    DKI - BALI (id=${areaDkiBali.id})`);
  console.log(`      → ${storeFF001.name} (${storeFF001.id})`);
  console.log(`      → ${storeFS033.name} (${storeFS033.id})`);
  console.log(`    JAWA BARAT - SUMATERA (id=${areaJabarSumatera.id})`);
  console.log(`      → ${storeFF012.name} (${storeFF012.id})`);
  console.log(`      → ${storeFS020.name} (${storeFS020.id})\n`);

  console.log("👤  OPS users:");
  console.log(
    "    OPS-HO-001                 Dummy OPS HO  → OPS HO / all areas",
  );
  console.log(
    "    OPS-DKI-BALI-001           Awan          → OPS Area / DKI - BALI",
  );
  console.log(
    "    OPS-JABAR-SUMATERA-001     Jayanti       → OPS Area / JAWA BARAT - SUMATERA\n",
  );

  console.log("👥  Users created:");
  for (const u of insertedUsers) {
    console.log(`    ${u.id.padEnd(8)}  NIK=${u.nik.padEnd(24)}  ${u.name}`);
  }

  console.log(`\n🔐  All passwords: ${DEFAULT_PASSWORD}`);
  console.log("🔑  Login uses NIK, not email.");
  console.log("═══════════════════════════════════════════════════════════");
}

seedSetup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌  seed-setup failed:", err);
    process.exit(1);
  });
