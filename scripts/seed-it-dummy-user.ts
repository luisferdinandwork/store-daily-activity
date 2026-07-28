// scripts/seed-it-dummy-user.ts
// ─────────────────────────────────────────────────────────────────────────────
// One-off: creates a dummy IT test account (NIK "IT-001") for trying out the
// new IT super-admin role and the role-switch feature. Safe to re-run — a
// no-op if the NIK already exists.
// ─────────────────────────────────────────────────────────────────────────────
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { userRoles, users } from '@/lib/db/schema';

const NIK = 'IT-001';
const NAME = 'IT Dummy';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'password123';
const SALT_ROUNDS = 10;

async function main() {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.nik, NIK)).limit(1);
  if (existing) {
    console.log(`ℹ️  User ${NIK} already exists (id ${existing.id}) — nothing to do.`);
    process.exit(0);
  }

  const [itRole] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.code, 'it')).limit(1);
  if (!itRole) {
    console.error("❌ 'it' role not found — run scripts/migrate-admin-role-to-it.ts first.");
    process.exit(1);
  }

  const hashed = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  const [created] = await db
    .insert(users)
    .values({
      nik: NIK,
      name: NAME,
      password: hashed,
      roleId: itRole.id,
      employeeTypeId: null,
      homeStoreId: null,
      areaId: null,
      isActive: true,
    })
    .returning({ id: users.id, nik: users.nik, name: users.name });

  console.log('✅ Created dummy IT user:');
  console.log(`   NIK:      ${created.nik}`);
  console.log(`   Name:     ${created.name}`);
  console.log(`   Password: ${PASSWORD}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ seed-it-dummy-user failed:', err);
  process.exit(1);
});
