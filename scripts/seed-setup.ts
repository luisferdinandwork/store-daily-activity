// scripts/seed-setup.ts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  userRoles, employeeTypes, shifts,
  areas, stores, users,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, itemDroppingTasks, briefingTasks,  
  edcReconciliationTasks, eodZReportTasks,              
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { hash } from 'bcryptjs';

const SALT_ROUNDS = 10;

function makeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

async function seedSetup() {
  console.log('🌱  seed-setup: lookups → areas → stores → users\n');

  // ── 0. CLEAR ALL (FK order: children → parents) ───────────────────────────
  console.log('🗑️   Clearing existing data…');
  await db.delete(breakSessions);
  await db.delete(groomingTasks);
  await db.delete(openStatementTasks);
  await db.delete(eodZReportTasks);
  await db.delete(edcReconciliationTasks);
  await db.delete(briefingTasks);
  await db.delete(itemDroppingTasks);
  await db.delete(productCheckTasks);
  await db.delete(cekBinTasks);
  await db.delete(setoranTasks);
  await db.delete(storeOpeningTasks);
  await db.delete(attendance);
  await db.delete(schedules);
  await db.delete(monthlyScheduleEntries);
  await db.delete(monthlySchedules);
  await db.delete(users);
  await db.delete(stores);
  await db.delete(areas);
  await db.delete(shifts);
  await db.delete(employeeTypes);
  await db.delete(userRoles);
  console.log('✓   Cleared\n');

  // ── 1. LOOKUP TABLES ──────────────────────────────────────────────────────
  console.log('📋  Seeding lookup tables…');

  const insertedRoles = await db
    .insert(userRoles)
    .values([
      { code: 'employee', label: 'Employee',   description: 'Store-level staff',          sortOrder: 10 },
      { code: 'ops',      label: 'Operations', description: 'Area operations manager',    sortOrder: 20 },
      { code: 'finance',  label: 'Finance',    description: 'Finance team',               sortOrder: 30 },
      { code: 'admin',    label: 'Admin',      description: 'System administrator',       sortOrder: 40 },
    ])
    .returning();

  const insertedEmpTypes = await db
    .insert(employeeTypes)
    .values([
      { code: 'pic_1', label: 'PIC 1', description: 'Person in charge — primary',   sortOrder: 10 },
      { code: 'pic_2', label: 'PIC 2', description: 'Person in charge — secondary', sortOrder: 20 },
      { code: 'sa',    label: 'SA',    description: 'Sales Associate',                sortOrder: 30 },
    ])
    .returning();

  const insertedShifts = await db
    .insert(shifts)
    .values([
      { code: 'morning',  label: 'Morning',  startTime: '07:00:00', endTime: '15:00:00', sortOrder: 10 },
      { code: 'evening',  label: 'Evening',  startTime: '15:00:00', endTime: '23:00:00', sortOrder: 20 },
      // full_day: employee covers both morning + evening tasks for the store that day.
      // materialiseTasksForSchedule creates both task sets when it sees this shift code.
      // The employee gets two breaks (full_day_lunch + full_day_dinner).
      { code: 'full_day', label: 'Full Day', startTime: '07:00:00', endTime: '23:00:00', sortOrder: 30 },
    ])
    .returning();

  const roleId    = Object.fromEntries(insertedRoles.map(r => [r.code, r.id]));
  const empTypeId = Object.fromEntries(insertedEmpTypes.map(r => [r.code, r.id]));

  console.log(`✓   ${insertedRoles.length} roles, ${insertedEmpTypes.length} employee types, ${insertedShifts.length} shifts\n`);

  // ── 2. AREAS ──────────────────────────────────────────────────────────────
  console.log('🗺️   Creating areas…');
  const [areaJP, areaJS] = await db
    .insert(areas)
    .values([
      { name: 'Area Jakarta Pusat'   },
      { name: 'Area Jakarta Selatan' },
    ])
    .returning();
  console.log(`✓   2 areas  (ids: ${areaJP.id}, ${areaJS.id})\n`);

  // ── 3. STORES ─────────────────────────────────────────────────────────────
  console.log('🏪  Creating stores…');
  const [store1, store2, store3] = await db
    .insert(stores)
    .values([
      {
        name: 'Store Thamrin',
        address: 'Jl. MH. Thamrin No. 1, Jakarta Pusat',
        areaId: areaJP.id,
        latitude: '-6.1630687', longitude: '106.7739266',
        geofenceRadiusM: '150', pettyCashBalance: '1000000',
      },
      {
        name: 'Store Gambir',
        address: 'Jl. Gambir No. 10, Jakarta Pusat',
        areaId: areaJP.id,
        latitude: '-6.1630687', longitude: '106.7739266',
        geofenceRadiusM: '150', pettyCashBalance: '1200000',
      },
      {
        name: 'Store Sudirman',
        address: 'Jl. Jend. Sudirman No. 52, Jakarta Selatan',
        areaId: areaJS.id,
        latitude: '-6.1630687', longitude: '106.7739266',
        geofenceRadiusM: '150', pettyCashBalance: '1500000',
      },
    ])
    .returning();
  console.log(`✓   3 stores  (ids: ${store1.id}, ${store2.id}, ${store3.id})\n`);

  // ── 4. USERS ──────────────────────────────────────────────────────────────
  console.log('👥  Creating users…');
  const pwd = await hash('password123', SALT_ROUNDS);

  let opsN = 0, empN = 0;
  const opsId = () => makeId('OPS', ++opsN);
  const empId = () => makeId('EMP', ++empN);

  type NewUser = typeof users.$inferInsert;

  const userDefs: NewUser[] = [
    // OPS
    { id: opsId(), name: 'Andi Wijaya', email: 'ops.jp@store.com', password: pwd, roleId: roleId.ops, employeeTypeId: null, homeStoreId: null, areaId: areaJP.id },
    { id: opsId(), name: 'Maya Sari',   email: 'ops.js@store.com', password: pwd, roleId: roleId.ops, employeeTypeId: null, homeStoreId: null, areaId: areaJS.id },

    // Store Thamrin
    { id: empId(), name: 'Budi Santoso',   email: 'budi@store.com',  password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.pic_1, homeStoreId: store1.id, areaId: null },
    { id: empId(), name: 'Ahmad Rahman',   email: 'ahmad@store.com', password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.pic_2, homeStoreId: store1.id, areaId: null },
    { id: empId(), name: 'Siti Nurhaliza', email: 'siti@store.com',  password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.sa,    homeStoreId: store1.id, areaId: null },
    { id: empId(), name: 'Dewi Lestari',   email: 'dewi@store.com',  password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.sa,    homeStoreId: store1.id, areaId: null },

    // Store Gambir
    { id: empId(), name: 'Eko Prasetyo', email: 'eko@store.com',  password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.pic_1, homeStoreId: store2.id, areaId: null },
    { id: empId(), name: 'Rina Wijaya',  email: 'rina@store.com', password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.sa,    homeStoreId: store2.id, areaId: null },

    // Store Sudirman
    { id: empId(), name: 'Farhan Hidayat', email: 'farhan@store.com', password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.pic_1, homeStoreId: store3.id, areaId: null },
    { id: empId(), name: 'Lina Permata',   email: 'lina@store.com',   password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.pic_2, homeStoreId: store3.id, areaId: null },
    { id: empId(), name: 'Hendra Kusuma',  email: 'hendra@store.com', password: pwd, roleId: roleId.employee, employeeTypeId: empTypeId.sa,    homeStoreId: store3.id, areaId: null },
  ];

  const insertedUsers: { id: string; name: string }[] = [];
  for (const u of userDefs) {
    const [row] = await db.insert(users).values(u).returning({ id: users.id, name: users.name });
    insertedUsers.push(row);
  }

  console.log(`✓   ${insertedUsers.length} users\n`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log('🗺️   Areas & Stores:');
  console.log(`    Jakarta Pusat   (id=${areaJP.id})  → ${store1.name} (${store1.id}), ${store2.name} (${store2.id})`);
  console.log(`    Jakarta Selatan (id=${areaJS.id})  → ${store3.name} (${store3.id})\n`);
  console.log('👥  Users created:');
  for (const u of insertedUsers) console.log(`    ${u.id.padEnd(8)}  ${u.name}`);
  console.log('\n🔐  All passwords: password123');
  console.log('═══════════════════════════════════════════════════════════');
}

seedSetup()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-setup failed:', err); process.exit(1); });