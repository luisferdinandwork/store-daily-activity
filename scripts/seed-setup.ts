// scripts/seed-setup.ts
// Seeds: areas → stores → users
// Run ONCE after db-reset + drizzle migrate.
// Run with: tsx scripts/seed-setup.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
import {
  areas, users, stores,
  monthlySchedules, monthlyScheduleEntries,
  schedules, attendance, breakSessions,
  storeOpeningTasks, groomingTasks,
} from '@/lib/db/schema';
import { hash } from 'bcryptjs';

const SALT_ROUNDS = 10;

async function seedSetup() {
  console.log('🌱  seed-setup: areas / stores / users\n');

  // ── 0. CLEAR ALL (ordered to respect FK constraints) ──────────────────────
  console.log('🗑️   Clearing existing data…');
  await db.delete(breakSessions);
  await db.delete(groomingTasks);
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
  const [areaJakartaPusat, areaJakartaSelatan] = await db
    .insert(areas)
    .values([
      { name: 'Area Jakarta Pusat' },
      { name: 'Area Jakarta Selatan' },
    ])
    .returning();
  console.log('✓   2 areas\n');

  // ── 2. STORES ─────────────────────────────────────────────────────────────
  console.log('🏪  Creating stores…');
  const [store1, store2, store3] = await db
    .insert(stores)
    .values([
      {
        name:             'Store Thamrin',
        address:          'Jl. Thamrin No. 1, Jakarta Pusat',
        areaId:           areaJakartaPusat.id,
        pettyCashBalance: '1000000',
      },
      {
        name:             'Store Gambir',
        address:          'Jl. Gambir No. 10, Jakarta Pusat',
        areaId:           areaJakartaPusat.id,
        pettyCashBalance: '1200000',
      },
      {
        name:             'Store Sudirman',
        address:          'Jl. Sudirman No. 52, Jakarta Selatan',
        areaId:           areaJakartaSelatan.id,
        pettyCashBalance: '1500000',
      },
    ])
    .returning();
  console.log('✓   3 stores\n');

  // ── 3. USERS ──────────────────────────────────────────────────────────────
  console.log('👥  Creating users…');
  const pwd = await hash('password123', SALT_ROUNDS);

  const insertedUsers = await db
    .insert(users)
    .values([
      // ── OPS ────────────────────────────────────────────────────────────────
      {
        name:         'Andi Wijaya',
        email:        'ops.jp@store.com',
        password:     pwd,
        role:         'ops'      as const,
        employeeType: null,
        homeStoreId:  null,
        areaId:       areaJakartaPusat.id,
      },
      {
        name:         'Maya Sari',
        email:        'ops.js@store.com',
        password:     pwd,
        role:         'ops'      as const,
        employeeType: null,
        homeStoreId:  null,
        areaId:       areaJakartaSelatan.id,
      },

      // ── Store Thamrin (store1) ──────────────────────────────────────────────
      {
        name:         'Budi Santoso',
        email:        'budi@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'pic_1'   as const,
        homeStoreId:  store1.id,
        areaId:       null,
      },
      {
        name:         'Ahmad Rahman',
        email:        'ahmad@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'pic_2'   as const,
        homeStoreId:  store1.id,
        areaId:       null,
      },
      {
        name:         'Siti Nurhaliza',
        email:        'siti@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'so'      as const,
        homeStoreId:  store1.id,
        areaId:       null,
      },
      {
        name:         'Dewi Lestari',
        email:        'dewi@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'so'      as const,
        homeStoreId:  store1.id,
        areaId:       null,
      },

      // ── Store Gambir (store2) ───────────────────────────────────────────────
      {
        name:         'Eko Prasetyo',
        email:        'eko@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'pic_1'   as const,
        homeStoreId:  store2.id,
        areaId:       null,
      },
      {
        name:         'Rina Wijaya',
        email:        'rina@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'so'      as const,
        homeStoreId:  store2.id,
        areaId:       null,
      },

      // ── Store Sudirman (store3) ─────────────────────────────────────────────
      {
        name:         'Farhan Hidayat',
        email:        'farhan@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'pic_1'   as const,
        homeStoreId:  store3.id,
        areaId:       null,
      },
      {
        name:         'Lina Permata',
        email:        'lina@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'pic_2'   as const,
        homeStoreId:  store3.id,
        areaId:       null,
      },
      {
        name:         'Hendra Kusuma',
        email:        'hendra@store.com',
        password:     pwd,
        role:         'employee' as const,
        employeeType: 'so'      as const,
        homeStoreId:  store3.id,
        areaId:       null,
      },
    ])
    .returning();

  console.log(`✓   ${insertedUsers.length} users\n`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log('    Run seed-schedules.ts next.\n');
  console.log('🗺️   Areas:');
  console.log('    Jakarta Pusat   → Store Thamrin + Store Gambir  (OPS: Andi)');
  console.log('    Jakarta Selatan → Store Sudirman                (OPS: Maya)\n');
  console.log('🔐  All passwords: password123\n');
  console.log('    ops.jp@store.com   — OPS Jakarta Pusat');
  console.log('    ops.js@store.com   — OPS Jakarta Selatan');
  console.log('    budi@store.com     — PIC 1, Store Thamrin');
  console.log('    ahmad@store.com    — PIC 2, Store Thamrin');
  console.log('    siti@store.com     — SO,    Store Thamrin');
  console.log('    dewi@store.com     — SO,    Store Thamrin');
  console.log('    eko@store.com      — PIC 1, Store Gambir');
  console.log('    rina@store.com     — SO,    Store Gambir');
  console.log('    farhan@store.com   — PIC 1, Store Sudirman');
  console.log('    lina@store.com     — PIC 2, Store Sudirman');
  console.log('    hendra@store.com   — SO,    Store Sudirman');
  console.log('═══════════════════════════════════════════════════════════');
}

seedSetup()
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌  seed-setup failed:', err); process.exit(1); });