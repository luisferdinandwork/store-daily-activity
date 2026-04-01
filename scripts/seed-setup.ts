// scripts/seed-setup.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds: areas → stores → users
//
// Changes from previous version
// ──────────────────────────────
//  • areas.id / stores.id are now serial (auto-increment) — no uuid supplied
//  • users.id is now your custom text format: "OPS-001", "EMP-001", etc.
//  • stores now have latitude / longitude / geofenceRadiusM for geo-validation
//  • homeStoreId / areaId on users are integers (serial FK), not uuids
//
// Run ONCE after db-reset + drizzle migrate:
//   tsx scripts/seed-setup.ts
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db }   from '@/lib/db';
import {
  areas, stores, users,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  storeOpeningTasks, setoranTasks, cekBinTasks,
  productCheckTasks, receivingTasks, briefingTasks,
  edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
  openStatementTasks, groomingTasks,
} from '@/lib/db/schema';
import { hash } from 'bcryptjs';

const SALT_ROUNDS = 10;

// ─── ID generator ─────────────────────────────────────────────────────────────
// Format: <prefix>-<zero-padded-counter>
// OPS users → OPS-001, OPS-002 …
// Employees → EMP-001, EMP-002 …

function makeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedSetup() {
  console.log('🌱  seed-setup: areas / stores / users\n');

  // ── 0. CLEAR ALL (FK order) ────────────────────────────────────────────────
  console.log('🗑️   Clearing existing data…');
  await db.delete(breakSessions);
  await db.delete(groomingTasks);
  await db.delete(openStatementTasks);
  await db.delete(eodZReportTasks);
  await db.delete(edcSettlementTasks);
  await db.delete(edcSummaryTasks);
  await db.delete(briefingTasks);
  await db.delete(receivingTasks);
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
  console.log('✓   Cleared\n');

  // ── 1. AREAS ──────────────────────────────────────────────────────────────
  console.log('🗺️   Creating areas…');
  const [areaJP, areaJS] = await db
    .insert(areas)
    .values([
      { name: 'Area Jakarta Pusat'   },
      { name: 'Area Jakarta Selatan' },
    ])
    .returning();
  console.log(`✓   2 areas  (ids: ${areaJP.id}, ${areaJS.id})\n`);

  // ── 2. STORES ─────────────────────────────────────────────────────────────
  console.log('🏪  Creating stores…');
  const [store1, store2, store3] = await db
    .insert(stores)
    .values([
      {
        name:            'Store Thamrin',
        address:         'Jl. MH. Thamrin No. 1, Jakarta Pusat',
        areaId:          areaJP.id,
        latitude:        '-6.1944400',   // example coords — update to real values
        longitude:       '106.8229800',
        geofenceRadiusM: '150',
        pettyCashBalance:'1000000',
      },
      {
        name:            'Store Gambir',
        address:         'Jl. Gambir No. 10, Jakarta Pusat',
        areaId:          areaJP.id,
        latitude:        '-6.1770000',
        longitude:       '106.8221000',
        geofenceRadiusM: '150',
        pettyCashBalance:'1200000',
      },
      {
        name:            'Store Sudirman',
        address:         'Jl. Jend. Sudirman No. 52, Jakarta Selatan',
        areaId:          areaJS.id,
        latitude:        '-6.2088000',
        longitude:       '106.8177000',
        geofenceRadiusM: '150',
        pettyCashBalance:'1500000',
      },
    ])
    .returning();
  console.log(`✓   3 stores  (ids: ${store1.id}, ${store2.id}, ${store3.id})\n`);

  // ── 3. USERS ──────────────────────────────────────────────────────────────
  console.log('👥  Creating users…');
  const pwd = await hash('password123', SALT_ROUNDS);

  // Counter tracks the numeric suffix per prefix
  let opsN = 0;
  let empN = 0;
  const opsId = () => makeId('OPS', ++opsN);
  const empId = () => makeId('EMP', ++empN);

  // Drizzle rejects a mixed-type array when some fields differ in nullability
  // (e.g. homeStoreId: null vs homeStoreId: number).  The fix is to use a
  // shared insert type via `typeof users.$inferInsert` and insert each user
  // individually, collecting the returned rows ourselves.
  type NewUser = typeof users.$inferInsert;

  const userDefs: NewUser[] = [
    // ── OPS ────────────────────────────────────────────────────────────────
    { id: opsId(), name: 'Andi Wijaya',   email: 'ops.jp@store.com', password: pwd, role: 'ops', employeeType: null, homeStoreId: null,     areaId: areaJP.id }, // OPS-001
    { id: opsId(), name: 'Maya Sari',     email: 'ops.js@store.com', password: pwd, role: 'ops', employeeType: null, homeStoreId: null,     areaId: areaJS.id }, // OPS-002

    // ── Store Thamrin ───────────────────────────────────────────────────────
    { id: empId(), name: 'Budi Santoso',  email: 'budi@store.com',   password: pwd, role: 'employee', employeeType: 'pic_1', homeStoreId: store1.id, areaId: null }, // EMP-001
    { id: empId(), name: 'Ahmad Rahman',  email: 'ahmad@store.com',  password: pwd, role: 'employee', employeeType: 'pic_2', homeStoreId: store1.id, areaId: null }, // EMP-002
    { id: empId(), name: 'Siti Nurhaliza',email: 'siti@store.com',   password: pwd, role: 'employee', employeeType: 'so',    homeStoreId: store1.id, areaId: null }, // EMP-003
    { id: empId(), name: 'Dewi Lestari',  email: 'dewi@store.com',   password: pwd, role: 'employee', employeeType: 'so',    homeStoreId: store1.id, areaId: null }, // EMP-004

    // ── Store Gambir ────────────────────────────────────────────────────────
    { id: empId(), name: 'Eko Prasetyo',  email: 'eko@store.com',    password: pwd, role: 'employee', employeeType: 'pic_1', homeStoreId: store2.id, areaId: null }, // EMP-005
    { id: empId(), name: 'Rina Wijaya',   email: 'rina@store.com',   password: pwd, role: 'employee', employeeType: 'so',    homeStoreId: store2.id, areaId: null }, // EMP-006

    // ── Store Sudirman ──────────────────────────────────────────────────────
    { id: empId(), name: 'Farhan Hidayat',email: 'farhan@store.com', password: pwd, role: 'employee', employeeType: 'pic_1', homeStoreId: store3.id, areaId: null }, // EMP-007
    { id: empId(), name: 'Lina Permata',  email: 'lina@store.com',   password: pwd, role: 'employee', employeeType: 'pic_2', homeStoreId: store3.id, areaId: null }, // EMP-008
    { id: empId(), name: 'Hendra Kusuma', email: 'hendra@store.com', password: pwd, role: 'employee', employeeType: 'so',    homeStoreId: store3.id, areaId: null }, // EMP-009
  ];

  // Insert one at a time to avoid the union-type overload error.
  // (Drizzle's .values([...]) overload requires all elements to share the
  // exact same literal types — impossible when homeStoreId and areaId differ.)
  const insertedUsers: { id: string; name: string; role: string }[] = [];
  for (const u of userDefs) {
    const [row] = await db
      .insert(users)
      .values(u)
      .returning({ id: users.id, name: users.name, role: users.role });
    insertedUsers.push(row);
  }

  console.log(`✓   ${insertedUsers.length} users\n`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log('    Run seed-schedules.ts next.\n');
  console.log('🗺️   Areas & Stores:');
  console.log(`    Jakarta Pusat   (id=${areaJP.id})  → Store Thamrin (${store1.id}), Store Gambir (${store2.id})`);
  console.log(`    Jakarta Selatan (id=${areaJS.id})  → Store Sudirman (${store3.id})\n`);
  console.log('👥  Users created:');
  for (const u of insertedUsers) {
    console.log(`    ${u.id.padEnd(8)}  ${u.name}`);
  }
  console.log('\n🔐  All passwords: password123');
  console.log('═══════════════════════════════════════════════════════════');
}

seedSetup()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌  seed-setup failed:', err); process.exit(1); });