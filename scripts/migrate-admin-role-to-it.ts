// scripts/migrate-admin-role-to-it.ts
// ─────────────────────────────────────────────────────────────────────────────
// One-off data fix: renames the legacy 'admin' role to 'it' (the new
// super-admin role), and ensures the 'audit' role exists. Safe to re-run —
// each step is a no-op if already applied.
//
// Any user currently logged in under the 'admin' role will need to log back
// in for their session to pick up the renamed role.
// ─────────────────────────────────────────────────────────────────────────────
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { userRoles } from '@/lib/db/schema';

async function main() {
  const [adminRole] = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.code, 'admin'))
    .limit(1);

  if (adminRole) {
    await db
      .update(userRoles)
      .set({ code: 'it', label: 'IT', updatedAt: new Date() })
      .where(eq(userRoles.id, adminRole.id));
    console.log(`✅ Renamed role '${adminRole.code}' (id ${adminRole.id}) → 'it'.`);
  } else {
    console.log("ℹ️  No 'admin' role row found — nothing to rename.");
  }

  const [auditRole] = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.code, 'audit'))
    .limit(1);

  if (!auditRole) {
    const [created] = await db
      .insert(userRoles)
      .values({
        code: 'audit',
        label: 'Audit',
        description: 'Audit team',
        canReceiveIssues: true,
        sortOrder: 35,
      })
      .returning();
    console.log(`✅ Created 'audit' role (id ${created.id}).`);
  } else {
    console.log("ℹ️  'audit' role already exists — skipped.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ migrate-admin-role-to-it failed:', err);
  process.exit(1);
});
