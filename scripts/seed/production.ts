// scripts/seed/production.ts
// ─────────────────────────────────────────────────────────────────────────────
// Production bootstrap seed.
//
// Unlike `npm run db:seed` (which builds a full demo world — stores, employees,
// a month of schedules/tasks/attendance), this seeds only the structural
// skeleton a fresh production database needs, plus ONE IT super-admin account.
// IT then creates areas, stores, users, schedules, etc. through the app.
//
// Seeds:
//   1. lookups        — user_roles, employee_types, shifts        (seedLookups)
//   2. shift-tasks    — task_definitions + default shift→task map  (seedShiftTasks)
//   3. target defaults — target_allocation_templates (PIC/SA % grid) (seedAllocationTemplate)
//   4. it-user        — one `it` account (this file)
//
// Everything is idempotent — safe to re-run.
//
// Usage:
//   • local:      npm run db:seed:prod       (loads .env.local via dotenv-cli)
//   • real prod:  export DATABASE_URL=… SEED_IT_PASSWORD=… ; npx tsx scripts/seed/production.ts
//
// IT credentials come from the environment (falls back to a default with a
// loud warning if unset):
//   SEED_IT_NIK       (default: IT-001)
//   SEED_IT_NAME      (default: IT Administrator)
//   SEED_IT_PASSWORD  (default: password123  ← change immediately)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
// Backup when run directly (not via the dotenv-cli wrapper) with a .env.local
// present. config() no-ops if the file is absent. NOTE: `@/lib/db` reads
// DATABASE_URL at import time, so in a real prod env the vars must already be
// exported before `tsx` starts (the dotenv-cli wrapper handles the local case).
config({ path: '.env.local' });
config({ path: '.env' });

import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import { db } from '@/lib/db';
import { userRoles, users } from '@/lib/db/schema';

import { seedLookups } from './setup';
import { seedShiftTasks } from './shift-tasks';
import { seedAllocationTemplate } from './performance-targets';

const SALT_ROUNDS = 10;
const DEFAULT_IT_NIK = 'IT-001';
const DEFAULT_IT_NAME = 'IT Administrator';
const DEFAULT_IT_PASSWORD = 'password123';

async function seedItUser() {
  const nik = (process.env.SEED_IT_NIK ?? DEFAULT_IT_NIK).trim();
  const name = (process.env.SEED_IT_NAME ?? DEFAULT_IT_NAME).trim();
  const password = process.env.SEED_IT_PASSWORD ?? DEFAULT_IT_PASSWORD;
  const usingDefaultPassword = !process.env.SEED_IT_PASSWORD;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.nik, nik))
    .limit(1);

  if (existing) {
    console.log(`ℹ️   User "${nik}" already exists (id ${existing.id}) — leaving it as-is.`);
    return;
  }

  const [itRole] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.code, 'it'))
    .limit(1);

  if (!itRole) {
    throw new Error("'it' role not found — the lookups step must run first.");
  }

  const [created] = await db
    .insert(users)
    .values({
      nik,
      name,
      password: await hash(password, SALT_ROUNDS),
      roleId: itRole.id,
      employeeTypeId: null,
      homeStoreId: null,
      areaId: null,
      isActive: true,
    })
    .returning({ id: users.id, nik: users.nik, name: users.name });

  console.log(`✓   Created IT user: NIK ${created.nik} · ${created.name}`);

  if (usingDefaultPassword) {
    console.log('');
    console.log('   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║  ⚠️   SEED_IT_PASSWORD was not set.                        ║');
    console.log(`   ║      This account uses the default password: ${DEFAULT_IT_PASSWORD}    ║`);
    console.log('   ║      CHANGE IT IMMEDIATELY after the first login.          ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝');
  } else {
    console.log('   Password set from SEED_IT_PASSWORD.');
  }
}

function fmtSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function run() {
  console.log('🌱 Production seed — skeleton + one IT account\n');

  const overallStart = Date.now();

  const step = async (name: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    console.log(`\n▶ ${name}`);
    await fn();
    console.log(`✓ ${name} done in ${fmtSeconds(Date.now() - start)}`);
  };

  await step('lookups', seedLookups);
  await step('shift-tasks', seedShiftTasks);
  await step('target-defaults', seedAllocationTemplate);
  await step('it-user', seedItUser);

  console.log(`\n✅ Production seed complete in ${fmtSeconds(Date.now() - overallStart)}.`);
  console.log('   Next: log in as the IT user and create areas, stores, and accounts.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Production seed failed:', err);
    process.exit(1);
  });
